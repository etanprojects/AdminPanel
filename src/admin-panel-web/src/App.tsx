import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Button,
  Center,
  Code,
  Collapse,
  Drawer,
  Group,
  Loader,
  Menu,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import {
  IconBolt,
  IconChevronDown,
  IconChevronUp,
  IconFileExport,
  IconFilter,
  IconFilterOff,
  IconHelp,
  IconHistory,
  IconListCheck,
  IconLogout,
  IconMoon,
  IconRefresh,
  IconSearch,
  IconSquareOff,
  IconSun,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { getUserName, isAuthEnabled, logout } from './auth'
import { ActionRunner } from './components/ActionRunner'
import { countActiveFilters, emptyFilters, FilterPanel, toTaskFilter, type FilterState } from './components/FilterPanel'
import { TaskTable, toRef } from './components/TaskTable'
import type { ActionInfo, AppConfig, Facets, JobSnapshot, Sort, TaskDto, TaskFilter, TaskRef } from './types'
import { downloadBlob, formatDate, plural } from './utils'

/** Maksymalna liczba zadań prezentowana na liście (limit okna wyników Elasticsearcha). */
const LIST_LIMIT = 10000

const fmt = (n: number) => n.toLocaleString('pl-PL')

type Runner = { action: ActionInfo; tasks: TaskRef[] } | { jobId: string }

export default function App({ config }: { config: AppConfig }) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()

  // ------------------------------------------------------------ filtry
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<FilterState>(emptyFilters)
  const [debouncedFilters] = useDebouncedValue(filters, 400)
  const [filtersOpen, setFiltersOpen] = useState(true)
  // snapshot Id zadań dla trybu "Pokaż tylko zaznaczone" (null = tryb wyłączony)
  const [onlyIds, setOnlyIds] = useState<string[] | null>(null)

  const baseFilter = useMemo(() => toTaskFilter(debouncedFilters, query), [debouncedFilters, query])
  const effectiveFilter: TaskFilter = useMemo(
    () => (onlyIds ? { ...baseFilter, ids: onlyIds } : baseFilter),
    [baseFilter, onlyIds],
  )

  // ------------------------------------------------------------ dane
  const [sort, setSort] = useState<Sort>({ field: 'createdAt', dir: 'desc' })
  const [items, setItems] = useState<TaskDto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [facets, setFacets] = useState<Facets>()
  const [actions, setActions] = useState<ActionInfo[]>([])
  const [userName, setUserName] = useState<string | null>(null)

  // ------------------------------------------------------------ zaznaczenie / akcje
  const [selected, setSelected] = useState<Map<string, TaskRef>>(new Map())
  const [selectingAll, setSelectingAll] = useState(false)
  const [runner, setRunner] = useState<Runner | null>(null)
  const [jobs, setJobs] = useState<JobSnapshot[] | null>(null)
  const [preview, setPreview] = useState<{ task: TaskDto; raw?: unknown; error?: string } | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    getUserName().then(setUserName)
    api.facets().then(setFacets).catch((e) => notifications.show({ color: 'red', title: 'Słowniki filtrów', message: e.message }))
    api.actions().then(setActions).catch((e) => notifications.show({ color: 'red', title: 'Definicje akcji', message: e.message }))
  }, [])

  // zmiana kryteriów = nowy zbiór wyników -> czyścimy zaznaczenie (żeby nie wykonać akcji na "niewidocznych" zadaniach)
  const filterKey = JSON.stringify(baseFilter)
  const prevFilterKey = useRef(filterKey)
  useEffect(() => {
    if (prevFilterKey.current === filterKey) return
    prevFilterKey.current = filterKey
    setOnlyIds(null)
    setSelected((prev) => {
      if (prev.size === 0) return prev
      notifications.show({ color: 'gray', message: `Zmieniono filtry - wyczyszczono zaznaczenie (${fmt(prev.size)}).` })
      return new Map()
    })
  }, [filterKey])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    api
      .search(effectiveFilter, 1, LIST_LIMIT, sort, controller.signal)
      .then((r) => {
        setItems(r.items)
        setTotal(r.total)
        setError(null)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [effectiveFilter, sort, reloadKey])

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

  const openPreview = useCallback((task: TaskDto) => {
    setPreview({ task })
    api
      .raw(task.id)
      .then((raw) => setPreview((p) => (p?.task.id === task.id ? { ...p, raw } : p)))
      .catch((e) => setPreview((p) => (p?.task.id === task.id ? { ...p, error: e.message } : p)))
  }, [])

  const selectAllResults = async () => {
    // wszystkie wyniki są już na liście - bez dodatkowego zapytania
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

  const clearFilters = () => {
    setFilters(emptyFilters)
    setQuery('')
    setQueryInput('')
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
                        <Text size="sm" fw={500}>{j.actionName}</Text>
                        <Text size="xs" c="dimmed">
                          {formatDate(j.startedAt)} · {j.startedBy}
                        </Text>
                      </div>
                      <Group gap={4} wrap="nowrap">
                        <Badge size="sm" color={j.state === 'Running' ? 'blue' : j.state === 'Completed' ? 'green' : 'orange'}>
                          {j.state === 'Running' ? `${j.processed}/${j.total}` : j.state}
                        </Badge>
                        <Badge size="sm" color="green" variant="light">{j.succeeded}</Badge>
                        <Badge size="sm" color="red" variant="light">{j.failed}</Badge>
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
            {isAuthEnabled() && (
              <Tooltip label="Wyloguj">
                <ActionIcon variant="subtle" color="gray" onClick={logout} aria-label="Wyloguj">
                  <IconLogout size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="sm">
          <Paper withBorder p="sm">
            <Stack gap="sm">
              <Group gap="xs" align="flex-end" wrap="nowrap">
                <TextInput
                  style={{ flex: 1 }}
                  label="Query string"
                  placeholder='np. keywords:"XXVIII C 11648/21" AND state:2001   (Enter - szukaj)'
                  leftSection={<IconSearch size={16} />}
                  rightSection={
                    <Tooltip
                      multiline
                      w={420}
                      label={
                        <>
                          Składnia Elasticsearch query_string, domyślnie AND. Przykłady:
                          <br />• ZAP-40401
                          <br />• keywords:"Irena Głowienka"
                          <br />• participants:PZ007385 AND NOT handledBy:PZ007385
                          <br />• slots.s0.stringValue:73370
                          <br />• state:2001 AND processName:Zapytanie*
                        </>
                      }
                    >
                      <IconHelp size={16} style={{ cursor: 'help' }} />
                    </Tooltip>
                  }
                  classNames={{ input: 'mono' }}
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setQuery(queryInput)}
                />
                <Button onClick={() => setQuery(queryInput)} leftSection={<IconSearch size={16} />}>
                  Szukaj
                </Button>
                <Button
                  variant={filtersOpen ? 'light' : 'default'}
                  leftSection={<IconFilter size={16} />}
                  rightSection={
                    <Group gap={6} wrap="nowrap">
                      {activeFilters > 0 && <Badge size="sm" circle>{activeFilters}</Badge>}
                      {filtersOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                    </Group>
                  }
                  onClick={() => setFiltersOpen((o) => !o)}
                >
                  Filtry
                </Button>
                <Tooltip label="Wyczyść wszystkie filtry">
                  <ActionIcon size="lg" variant="default" disabled={activeFilters === 0 && !query} onClick={clearFilters}>
                    <IconFilterOff size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Collapse expanded={filtersOpen}>
                <FilterPanel value={filters} onChange={setFilters} facets={facets} />
              </Collapse>
            </Stack>
          </Paper>

          <Group justify="space-between">
            <Group gap="md">
              <Text fw={600}>
                Znaleziono: {fmt(total)} {plural(total, 'zadanie', 'zadania', 'zadań')}
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
              <Button size="xs" variant="light" loading={selectingAll} disabled={total === 0 || onlyIds !== null} onClick={selectAllResults}>
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
                <ActionIcon variant="default" size="lg" onClick={() => setReloadKey((k) => k + 1)}>
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
                      <Text size="sm" fw={500}>{a.name}</Text>
                      {a.description && <Text size="xs" c="dimmed" maw={320}>{a.description}</Text>}
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
              onOpen={openPreview}
            />
          </Paper>
        </Stack>
      </AppShell.Main>

      <Drawer
        opened={preview !== null}
        onClose={() => setPreview(null)}
        position="right"
        size="xl"
        title={<Text fw={600}>Zadanie {preview?.task.workflowId}</Text>}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {preview?.error && <Alert color="red">{preview.error}</Alert>}
        {preview && !preview.error && (
          <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {preview.raw ? JSON.stringify(preview.raw, null, 2) : 'Ładowanie…'}
          </Code>
        )}
      </Drawer>

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
    </AppShell>
  )
}
