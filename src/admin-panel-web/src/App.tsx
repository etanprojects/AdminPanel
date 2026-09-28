import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Button,
  Center,
  Collapse,
  Group,
  Loader,
  Menu,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { lazy, Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { getUserName } from './auth'
import { countActiveFilters, emptyFilters, FilterPanel, toTaskFilter, type FilterState } from './components/FilterPanel'
import { QueryBar } from './components/QueryBar'
import { TaskTable, toRef } from './components/TaskTable'
import {
  IconBolt,
  IconFileExport,
  IconHistory,
  IconListCheck,
  IconMoon,
  IconRefresh,
  IconSquareOff,
  IconSun,
} from './icons'
import type { ActionInfo, AppConfig, Facets, JobSnapshot, Sort, TaskDto, TaskFilter, TaskRef } from './types'
import { downloadBlob, formatDate, plural } from './utils'

const ActionRunner = lazy(() => import('./components/ActionRunner').then((m) => ({ default: m.ActionRunner })))
const TaskPreview = lazy(() => import('./components/TaskPreview').then((m) => ({ default: m.TaskPreview })))

const LIST_LIMIT = 10000

const fmt = (n: number) => n.toLocaleString('pl-PL')

const hasAnyValue = (f: TaskFilter) => Object.values(f).some((v) => v !== undefined)

type Runner = { action: ActionInfo; tasks: TaskRef[] } | { jobId: string }

export default function App({ config }: { config: AppConfig }) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()

  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<FilterState>(emptyFilters)
  const [debouncedText] = useDebouncedValue(`${filters.id}\u0000${filters.workflowId}`, 350)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [onlyIds, setOnlyIds] = useState<string[] | null>(null)

  const baseFilter = useMemo(() => {
    const [id, workflowId] = debouncedText.split('\u0000')
    return toTaskFilter({ ...filters, id, workflowId }, query)
  }, [debouncedText, query, filters.processNames, filters.stepNames, filters.handledByNames, filters.notHandled, filters.created, filters.updated])

  const effectiveFilter: TaskFilter = useMemo(
    () => (onlyIds ? { ...baseFilter, ids: onlyIds } : baseFilter),
    [baseFilter, onlyIds],
  )
  const hasCriteria = hasAnyValue(effectiveFilter)

  const [sort, setSort] = useState<Sort>({ field: 'createdAt', dir: 'desc' })
  const [items, setItems] = useState<TaskDto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [facets, setFacets] = useState<Facets>()
  const [actions, setActions] = useState<ActionInfo[]>([])
  const [userName, setUserName] = useState<string | null>(null)

  const [selected, setSelected] = useState<Map<string, TaskRef>>(new Map())
  const [selectingAll, setSelectingAll] = useState(false)
  const [runner, setRunner] = useState<Runner | null>(null)
  const [jobs, setJobs] = useState<JobSnapshot[] | null>(null)
  const [previewTask, setPreviewTask] = useState<TaskDto | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    getUserName().then(setUserName)
    api.facets().then(setFacets).catch((e) => notifications.show({ color: 'red', title: 'Słowniki filtrów', message: e.message }))
    api.actions().then(setActions).catch((e) => notifications.show({ color: 'red', title: 'Definicje akcji', message: e.message }))
  }, [])

  const filterKey = JSON.stringify(baseFilter)
  const prevFilterKey = useRef(filterKey)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  useEffect(() => {
    if (prevFilterKey.current === filterKey) return
    prevFilterKey.current = filterKey
    setOnlyIds(null)
    const count = selectedRef.current.size
    if (count === 0) return
    setSelected(new Map())
    notifications.show({ color: 'gray', message: `Zmieniono filtry - wyczyszczono zaznaczenie (${fmt(count)}).` })
  }, [filterKey])

  useEffect(() => {
    if (!hasCriteria) {
      setItems([])
      setTotal(0)
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    api
      .search(effectiveFilter, 1, LIST_LIMIT, sort, controller.signal)
      .then((r) => {
        startTransition(() => {
          setItems(r.items)
          setTotal(r.total)
          setError(null)
        })
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [effectiveFilter, hasCriteria, sort, reloadKey])

  const queryRef = useRef(query)
  queryRef.current = query
  const search = useCallback((q: string) => {
    const value = q.trim()
    if (value === queryRef.current) setReloadKey((k) => k + 1)
    else setQuery(value)
  }, [])

  const toggleFilters = useCallback(() => setFiltersOpen((o) => !o), [])

  const clearFilters = useCallback(() => {
    setFilters(emptyFilters)
    setQuery('')
  }, [])

  const toggle = useCallback((tasks: TaskDto[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const t of tasks) {
        if (checked) next.set(t.id, toRef(t))
        else next.delete(t.id)
      }
      return next
    })
  }, [])

  const selectAllResults = async () => {
    if (total <= items.length) {
      setSelected(new Map(items.map((t) => [t.id, toRef(t)])))
      return
    }
    setSelectingAll(true)
    try {
      const r = await api.refs(effectiveFilter)
      setSelected(new Map(r.items.map((t) => [t.id, t])))
      if (r.truncated)
        notifications.show({
          color: 'orange',
          title: 'Zaznaczono część wyników',
          message: `Limit ${fmt(config.maxBulkResults)} zadań - zaznaczono ${fmt(r.items.length)} z ${fmt(r.total)}. Zawęź filtry.`,
        })
    } catch (e) {
      notifications.show({ color: 'red', title: 'Błąd', message: (e as Error).message })
    } finally {
      setSelectingAll(false)
    }
  }

  const exportCsv = async (onlySelected: boolean) => {
    setExporting(true)
    try {
      const f = onlySelected ? { ids: [...selected.keys()] } : effectiveFilter
      const { blob, name } = await api.exportCsv(f, sort)
      downloadBlob(blob, name)
    } catch (e) {
      notifications.show({ color: 'red', title: 'Eksport CSV', message: (e as Error).message })
    } finally {
      setExporting(false)
    }
  }

  const activeFilters = countActiveFilters(filters)
  const allResults = Math.min(total, config.maxBulkResults)

  return (
    <AppShell header={{ height: 52 }} padding="md">
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between">
          <Group gap="xs">
            <IconListCheck />
            <Title order={4}>Panel administracyjny zadań</Title>
            {config.sampleData && (
              <Badge color="orange" variant="light">
                dane przykładowe
              </Badge>
            )}
          </Group>
          <Group gap="xs">
            <Menu position="bottom-end" width={440} onOpen={() => api.jobs().then(setJobs).catch(() => setJobs([]))}>
              <Menu.Target>
                <Button variant="subtle" color="gray" size="xs" leftSection={<IconHistory size={16} />}>
                  Historia wykonań
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {jobs === null && (
                  <Center>
                    <Loader size="sm" m="sm" />
                  </Center>
                )}
                {jobs?.length === 0 && <Menu.Label>Brak wykonań (historia trzymana 24 h)</Menu.Label>}
                {jobs?.map((j) => (
                  <Menu.Item key={j.jobId} onClick={() => setRunner({ jobId: j.jobId })}>
                    <Group justify="space-between" wrap="nowrap">
                      <div>
                        <Text size="sm" fw={500}>
                          {j.actionName}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {formatDate(j.startedAt)} · {j.startedBy}
                        </Text>
                      </div>
                      <Group gap={4} wrap="nowrap">
                        <Badge size="sm" color={j.state === 'Running' ? 'blue' : j.state === 'Completed' ? 'green' : 'orange'}>
                          {j.state === 'Running' ? `${j.processed}/${j.total}` : j.state}
                        </Badge>
                        <Badge size="sm" color="green" variant="light">
                          {j.succeeded}
                        </Badge>
                        <Badge size="sm" color="red" variant="light">
                          {j.failed}
                        </Badge>
                      </Group>
                    </Group>
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            {userName && <Text size="sm">{userName}</Text>}
            <ActionIcon variant="subtle" color="gray" onClick={toggleColorScheme} aria-label="Motyw">
              {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="sm">
          <Paper withBorder p="sm">
            <Stack gap="sm">
              <QueryBar
                query={query}
                onSearch={search}
                filtersOpen={filtersOpen}
                onToggleFilters={toggleFilters}
                activeFilters={activeFilters}
                onClear={clearFilters}
              />
              <Collapse expanded={filtersOpen}>
                <FilterPanel value={filters} onChange={setFilters} facets={facets} />
              </Collapse>
            </Stack>
          </Paper>

          <Group justify="space-between">
            <Group gap="md">
              <Text fw={600}>
                {hasCriteria ? `Znaleziono: ${fmt(total)} ${plural(total, 'zadanie', 'zadania', 'zadań')}` : 'Brak kryteriów wyszukiwania'}
                {total > items.length && !loading && (
                  <Text span c="orange" size="sm" fw={400}>
                    {' '}
                    (na liście pierwsze {fmt(items.length)})
                  </Text>
                )}
              </Text>
              <Badge size="lg" variant={selected.size ? 'filled' : 'light'} color={selected.size ? 'blue' : 'gray'}>
                Zaznaczono: {fmt(selected.size)}
              </Badge>
              <Button
                size="xs"
                variant="light"
                loading={selectingAll}
                disabled={total === 0 || onlyIds !== null}
                onClick={selectAllResults}
              >
                Zaznacz wszystkie wyniki ({fmt(allResults)})
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                leftSection={<IconSquareOff size={14} />}
                disabled={selected.size === 0}
                onClick={() => {
                  setSelected(new Map())
                  setOnlyIds(null)
                }}
              >
                Wyczyść zaznaczenie
              </Button>
              <Switch
                size="sm"
                label="Pokaż tylko zaznaczone"
                checked={onlyIds !== null}
                disabled={selected.size === 0 && onlyIds === null}
                onChange={(e) => setOnlyIds(e.currentTarget.checked ? [...selected.keys()] : null)}
              />
            </Group>
            <Group gap="xs">
              <Tooltip label="Odśwież">
                <ActionIcon variant="default" size="lg" disabled={!hasCriteria} onClick={() => setReloadKey((k) => k + 1)}>
                  <IconRefresh size={18} />
                </ActionIcon>
              </Tooltip>
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button variant="default" loading={exporting} leftSection={<IconFileExport size={16} />}>
                    Eksport CSV
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item disabled={total === 0} onClick={() => exportCsv(false)}>
                    Wszystkie odfiltrowane ({fmt(allResults)})
                  </Menu.Item>
                  <Menu.Item disabled={selected.size === 0} onClick={() => exportCsv(true)}>
                    Tylko zaznaczone ({fmt(selected.size)})
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button leftSection={<IconBolt size={16} />} disabled={selected.size === 0 || actions.length === 0}>
                    Wykonaj akcję ({fmt(selected.size)})
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Akcja dla zaznaczonych zadań</Menu.Label>
                  {actions.map((a) => (
                    <Menu.Item key={a.key} color={a.color} onClick={() => setRunner({ action: a, tasks: [...selected.values()] })}>
                      <Text size="sm" fw={500}>
                        {a.name}
                      </Text>
                      {a.description && (
                        <Text size="xs" c="dimmed" maw={320}>
                          {a.description}
                        </Text>
                      )}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Group>

          {error && (
            <Alert color="red" title="Błąd pobierania zadań" withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Paper withBorder>
            <TaskTable
              items={items}
              loading={loading}
              sort={sort}
              onSort={setSort}
              selected={selected}
              onToggle={toggle}
              onOpen={setPreviewTask}
              emptyMessage={
                hasCriteria
                  ? undefined
                  : 'Ustaw co najmniej jeden filtr albo wpisz zapytanie i kliknij „Szukaj”. Aby wyświetlić wszystkie zadania, wpisz * w query string.'
              }
            />
          </Paper>
        </Stack>
      </AppShell.Main>

      <Suspense fallback={null}>
        {previewTask && <TaskPreview task={previewTask} onClose={() => setPreviewTask(null)} />}

        {runner && (
          <ActionRunner
            key={'jobId' in runner ? runner.jobId : runner.action.key}
            action={'action' in runner ? runner.action : undefined}
            tasks={'tasks' in runner ? runner.tasks : undefined}
            jobId={'jobId' in runner ? runner.jobId : undefined}
            onSelectTasks={(tasks) => {
              setSelected(new Map(tasks.map((t) => [t.id, t])))
              setOnlyIds(tasks.map((t) => t.id))
            }}
            onClose={(executed) => {
              setRunner(null)
              if (executed) {
                setReloadKey((k) => k + 1)
                api.facets().then(setFacets).catch(() => {})
              }
            }}
          />
        )}
      </Suspense>
    </AppShell>
  )
}
