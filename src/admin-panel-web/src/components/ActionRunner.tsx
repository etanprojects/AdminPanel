import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core'
import {
  IconAlertTriangle,
  IconDownload,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlugConnected,
  IconPlugConnectedX,
  IconSelect,
} from '../icons'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api, watchJob } from '../api'
import type {
  ActionInfo,
  ActionParameter,
  ExecutionResult,
  JobProgress,
  JobSnapshot,
  ParameterValue,
  TaskRef,
} from '../types'
import { buildCsv, downloadBlob, plural, timestamp } from '../utils'

type Phase = 'config' | 'running' | 'done'
type JobInfo = Omit<JobSnapshot, 'results'>
const MAX_VISIBLE_RESULTS = 500

interface Props {
  action?: ActionInfo
  tasks?: TaskRef[]
  jobId?: string
  onClose: (executed: boolean) => void
  onSelectTasks: (tasks: TaskRef[]) => void
}

function defaults(params: ActionParameter[]): Record<string, ParameterValue> {
  return Object.fromEntries(
    params.map((p) => [p.name, p.default ?? (p.type === 'boolean' ? false : p.type === 'number' ? null : '')]),
  )
}

function preview(template: unknown, task: TaskRef | undefined, params: Record<string, ParameterValue>): unknown {
  const resolve = (name: string): unknown => {
    const [scope, key] = name.split('.', 2)
    if (scope === 'task') return task?.[key as keyof TaskRef] ?? null
    if (scope === 'param') return params[key] ?? null
    return `{{${name}}}`
  }
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object')
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]))
    if (typeof node === 'string') {
      const whole = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/.exec(node)
      if (whole) return resolve(whole[1])
      return node.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, n) => String(resolve(n) ?? ''))
    }
    return node
  }
  return walk(template)
}

export function ActionRunner({ action, tasks = [], jobId: existingJobId, onClose, onSelectTasks }: Props) {
  const [phase, setPhase] = useState<Phase>(existingJobId ? 'running' : 'config')
  const [params, setParams] = useState(() => defaults(action?.parameters ?? []))
  const [confirmed, setConfirmed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(existingJobId ?? null)
  const [job, setJob] = useState<JobInfo | null>(null)
  const [results, setResults] = useState<ExecutionResult[]>([])
  const [connection, setConnection] = useState<'connected' | 'reconnecting' | 'disconnected'>('connected')
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [view, setView] = useState<'all' | 'errors'>('all')
  const [, setTick] = useState(0)

  const resultsRef = useRef(new Map<number, ExecutionResult>())
  const dirtyRef = useRef(false)

  const title = action?.name ?? job?.actionName ?? 'Akcja'
  const total = job?.total ?? tasks.length

  useEffect(() => {
    if (phase !== 'running') return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [phase])

  useEffect(() => {
    if (!jobId) return
    let stopConnection: (() => Promise<void>) | null = null
    let disposed = false

    const apply = (p: JobProgress) => {
      setJob((j) =>
        j ? { ...j, state: p.state, processed: p.processed, succeeded: p.succeeded, failed: p.failed, error: p.error } : j,
      )
      if (p.state !== 'Running') setPhase('done')
    }
    const flushTimer = window.setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setResults([...resultsRef.current.values()])
    }, 200)
    const clock = window.setInterval(() => setTick((t) => t + 1), 1000)

    watchJob(jobId, {
      onSnapshot: (snap) => {
        for (const r of snap.results) resultsRef.current.set(r.index, r)
        dirtyRef.current = true
        const info: JobInfo = { ...snap }
        delete (info as Partial<JobSnapshot>).results
        setJob(info)
        setPhase(snap.state === 'Running' ? 'running' : 'done')
      },
      onProgress: (p) => {
        if (p.result) {
          resultsRef.current.set(p.result.index, p.result)
          dirtyRef.current = true
        }
        apply(p)
      },
      onFinished: (p) => {
        dirtyRef.current = true
        apply(p)
      },
      onConnection: setConnection,
    })
      .then((stop) => {
        stopConnection = stop
        if (disposed) stop()
      })
      .catch((e) => {
        setFatalError(e instanceof Error ? e.message : String(e))
        setPhase('done')
      })

    return () => {
      disposed = true
      window.clearInterval(flushTimer)
      window.clearInterval(clock)
      stopConnection?.()
    }
  }, [jobId])

  const missingRequired = (action?.parameters ?? []).filter(
    (p) => p.required && (params[p.name] === null || params[p.name] === '' || params[p.name] === undefined),
  )
  const canRun = !!action && tasks.length > 0 && missingRequired.length === 0 && confirmed
  const blockers = [
    ...missingRequired.map((p) => `uzupełnij „${p.label}”`),
    ...(tasks.length > 0 && !confirmed ? ['zaznacz potwierdzenie'] : []),
  ]

  const run = async () => {
    if (!action) return
    setStarting(true)
    setFatalError(null)
    try {
      const r = await api.startJob(action.key, params, tasks)
      setJobId(r.jobId)
      setPhase('running')
    } catch (e) {
      setFatalError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  const stop = () => {
    if (jobId) api.cancelJob(jobId).catch((e) => setFatalError(e.message))
  }

  const succeeded = job?.succeeded ?? 0
  const failed = job?.failed ?? 0
  const processed = job?.processed ?? 0
  const notProcessed = total - processed
  const state = job?.state

  const failedRefs = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]))
    return results
      .filter((r) => !r.success)
      .map((r): TaskRef => byId.get(r.id) ?? { id: r.id, workflowId: r.workflowId })
  }, [results, tasks])

  const unprocessedRefs = useMemo(() => {
    if (phase !== 'done') return []
    const done = new Set(results.map((r) => r.id))
    return tasks.filter((t) => !done.has(t.id))
  }, [results, tasks, phase])

  const downloadResults = () => {
    const rows: unknown[][] = results
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((r) => [r.id, r.workflowId ?? '', r.statusCode ?? (r.success ? 'OK' : 'brak odpowiedzi'), r.error ?? ''])
    for (const t of unprocessedRefs) rows.push([t.id, t.workflowId ?? '', 'nie wykonano', 'Operacja przerwana'])
    downloadBlob(
      buildCsv(['Id zadania', 'Numer zadania', 'Status', 'Błąd'], rows),
      `wynik_${job?.actionKey ?? action?.key ?? 'akcja'}_${timestamp()}.csv`,
    )
  }

  const visible = useMemo(() => {
    const list = view === 'errors' ? results.filter((r) => !r.success) : results
    return list.slice(-MAX_VISIBLE_RESULTS).reverse()
  }, [results, view])

  const startedAt = job ? new Date(job.startedAt).getTime() : 0
  const endAt = job?.finishedAt ? new Date(job.finishedAt).getTime() : Date.now()
  const elapsed = job ? Math.max(0, (endAt - startedAt) / 1000) : 0

  const statusLabel =
    phase === 'running'
      ? 'Wykonywanie…'
      : state === 'Cancelled'
        ? 'Przerwano'
        : state === 'Failed'
          ? 'Błąd'
          : 'Zakończono'

  const field = (p: ActionParameter) => {
    const common = { label: p.label, description: p.description, required: p.required }
    const set = (v: ParameterValue) => setParams((prev) => ({ ...prev, [p.name]: v }))
    switch (p.type) {
      case 'boolean':
        return (
          <Switch {...common} checked={Boolean(params[p.name])} onChange={(e) => set(e.currentTarget.checked)} color="red" />
        )
      case 'textarea':
        return (
          <Textarea
            {...common}
            autosize
            minRows={3}
            maxRows={8}
            value={String(params[p.name] ?? '')}
            onChange={(e) => set(e.currentTarget.value)}
          />
        )
      case 'number':
        return (
          <NumberInput
            {...common}
            value={(params[p.name] as number | null) ?? ''}
            onChange={(v) => set(typeof v === 'number' ? v : null)}
          />
        )
      case 'select':
        return (
          <Select
            {...common}
            data={p.options ?? []}
            value={(params[p.name] as string) || null}
            onChange={(v) => set(v ?? '')}
          />
        )
      default:
        return <TextInput {...common} value={String(params[p.name] ?? '')} onChange={(e) => set(e.currentTarget.value)} />
    }
  }

  return (
    <Modal
      opened
      onClose={() => onClose(phase !== 'config')}
      closeOnClickOutside={phase === 'config'}
      closeOnEscape={phase !== 'running'}
      withCloseButton={phase !== 'running'}
      size="xl"
      title={
        <Group gap="xs">
          <Text fw={600}>{title}</Text>
          <Badge variant="light">
            {total} {plural(total, 'zadanie', 'zadania', 'zadań')}
          </Badge>
          {job && (
            <Text size="xs" c="dimmed">
              uruchomił(a): {job.startedBy}
            </Text>
          )}
        </Group>
      }
    >
      {phase === 'config' && action && (
        <Stack>
          {action.description && (
            <Text size="sm" c="dimmed">
              {action.description}
            </Text>
          )}
          <Paper withBorder p="xs">
            <Text size="xs" c="dimmed" mb={4}>
              Request dla każdego zadania ({action.parallelism} równolegle, autoryzacja: {action.auth}) - podgląd dla
              pierwszego zadania
            </Text>
            <Code block>
              {`${action.method} ${action.url}\n`}
              {action.body !== undefined && action.body !== null
                ? JSON.stringify(preview(action.body, tasks[0], params), null, 2)
                : ''}
            </Code>
          </Paper>

          {action.parameters.map((p) => (
            <Fragment key={p.name}>{field(p)}</Fragment>
          ))}

          {total === 0 ? (
            <Alert color="yellow">Nie zaznaczono żadnych zadań.</Alert>
          ) : (
            <Alert color="orange" icon={<IconAlertTriangle />} variant="light">
              <Checkbox
                label={`Potwierdzam wykonanie akcji „${action.name}” dla ${total} ${plural(total, 'zadania', 'zadań', 'zadań')}.`}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.currentTarget.checked)}
              />
            </Alert>
          )}

          {fatalError && (
            <Alert color="red" title="Nie udało się uruchomić akcji">
              {fatalError}
            </Alert>
          )}

          <Group justify="flex-end">
            {blockers.length > 0 && (
              <Text size="sm" c="orange">
                Aby uruchomić: {blockers.join(', ')}
              </Text>
            )}
            <Button variant="default" onClick={() => onClose(false)}>
              Anuluj
            </Button>
            <Button
              color={action.color ?? 'blue'}
              leftSection={<IconPlayerPlay size={16} />}
              disabled={!canRun}
              loading={starting}
              onClick={run}
            >
              Uruchom
            </Button>
          </Group>
        </Stack>
      )}

      {phase !== 'config' && (
        <Stack>
          <div>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={500}>
                {statusLabel} {processed} / {total}
              </Text>
              <Group gap={6}>
                {phase === 'running' &&
                  (connection === 'connected' ? (
                    <Tooltip label="Połączono (WebSocket)">
                      <IconPlugConnected size={16} color="var(--mantine-color-green-6)" />
                    </Tooltip>
                  ) : (
                    <Tooltip label="Utracono połączenie - wznawianie… (job działa dalej na serwerze)">
                      <IconPlugConnectedX size={16} color="var(--mantine-color-orange-6)" />
                    </Tooltip>
                  ))}
                <Text size="sm" c="dimmed">
                  {total ? Math.round((processed / total) * 100) : 0}% · {elapsed.toFixed(0)} s
                </Text>
              </Group>
            </Group>
            <Progress.Root size={22}>
              <Progress.Section value={(succeeded / Math.max(total, 1)) * 100} color="green" animated={phase === 'running'}>
                {succeeded > 0 && <Progress.Label>{succeeded}</Progress.Label>}
              </Progress.Section>
              <Progress.Section value={(failed / Math.max(total, 1)) * 100} color="red" animated={phase === 'running'}>
                {failed > 0 && <Progress.Label>{failed}</Progress.Label>}
              </Progress.Section>
            </Progress.Root>
          </div>

          <SimpleGrid cols={notProcessed > 0 && phase === 'done' ? 4 : 3}>
            <Stat label="Łącznie" value={total} />
            <Stat label="Udane" value={succeeded} color="green" />
            <Stat label="Błędne" value={failed} color="red" />
            {notProcessed > 0 && phase === 'done' && <Stat label="Niewykonane" value={notProcessed} color="gray" />}
          </SimpleGrid>

          {(fatalError || job?.error) && (
            <Alert color="red" title="Wykonanie przerwane błędem">
              {fatalError ?? job?.error}
            </Alert>
          )}

          <Group justify="space-between">
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => setView(v as 'all' | 'errors')}
              data={[
                { value: 'all', label: `Wszystkie (${results.length})` },
                { value: 'errors', label: `Błędy (${failedRefs.length})` },
              ]}
            />
            {visible.length === MAX_VISIBLE_RESULTS && (
              <Text size="xs" c="dimmed">
                pokazano ostatnie {MAX_VISIBLE_RESULTS} - pełny wynik w pliku CSV
              </Text>
            )}
          </Group>

          <ScrollArea h={280} type="auto">
            <Table fz="xs" striped stickyHeader verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>Numer zadania</Table.Th>
                  <Table.Th>Id zadania</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Błąd</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.map((r) => (
                  <Table.Tr key={r.index}>
                    <Table.Td>{r.index + 1}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.workflowId}</Table.Td>
                    <Table.Td className='mono' style={{ whiteSpace: 'nowrap' }}>{r.id}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <Badge size="sm" color={r.success ? 'green' : 'red'} variant="light">
                        {r.statusCode ?? 'ERR'}
                      </Badge>
                    </Table.Td>
                    <Table.Td style={{ wordBreak: 'break-word' }}>{r.error}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          <Group justify="space-between">
            <Group gap="xs">
              {phase === 'done' && failedRefs.length + unprocessedRefs.length > 0 && (
                <Button
                  variant="light"
                  leftSection={<IconSelect size={16} />}
                  onClick={() => {
                    onSelectTasks([...failedRefs, ...unprocessedRefs])
                    onClose(true)
                  }}
                >
                  Zaznacz błędne i niewykonane ({failedRefs.length + unprocessedRefs.length})
                </Button>
              )}
            </Group>
            <Group gap="xs">
              {phase === 'running' ? (
                <>
                  <Tooltip label="Job działa na serwerze - możesz zamknąć okno i wrócić do niego z Historii wykonań">
                    <Button variant="default" onClick={() => onClose(true)}>
                      Działaj w tle
                    </Button>
                  </Tooltip>
                  <Button color="red" variant="light" leftSection={<IconPlayerStop size={16} />} onClick={stop}>
                    Przerwij
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="default" leftSection={<IconDownload size={16} />} onClick={downloadResults}>
                    Zapisz wynik (CSV)
                  </Button>
                  <Button onClick={() => onClose(true)}>Zamknij</Button>
                </>
              )}
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Paper withBorder p="xs" ta="center">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} c={color}>
        {value}
      </Text>
    </Paper>
  )
}
