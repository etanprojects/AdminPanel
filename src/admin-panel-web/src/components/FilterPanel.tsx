import { ActionIcon, Checkbox, CloseButton, Group, Input, Menu, MultiSelect, SimpleGrid, TextInput } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import dayjs from 'dayjs'
import { memo, useMemo } from 'react'
import { IconCalendar } from '../icons'
import type { Facets, FacetValue, TaskFilter } from '../types'
import { toApiDate } from '../utils'

type Range = [string | null, string | null]

export interface FilterState {
  id: string
  workflowId: string
  processNames: string[]
  stepNames: string[]
  handledByNames: string[]
  notHandled: boolean
  created: Range
  updated: Range
}

export const emptyFilters: FilterState = {
  id: '',
  workflowId: '',
  processNames: [],
  stepNames: [],
  handledByNames: [],
  notHandled: false,
  created: [null, null],
  updated: [null, null],
}

export function toTaskFilter(f: FilterState, query: string): TaskFilter {
  return {
    query: query.trim() || undefined,
    id: f.id.trim() || undefined,
    workflowId: f.workflowId.trim() || undefined,
    processNames: f.processNames.length ? f.processNames : undefined,
    stepNames: f.stepNames.length ? f.stepNames : undefined,
    handledByNames: !f.notHandled && f.handledByNames.length ? f.handledByNames : undefined,
    notHandled: f.notHandled || undefined,
    createdFrom: toApiDate(f.created[0]),
    createdTo: toApiDate(f.created[1]),
    updatedFrom: toApiDate(f.updated[0]),
    updatedTo: toApiDate(f.updated[1]),
  }
}

export function countActiveFilters(f: FilterState): number {
  return [
    f.id.trim(),
    f.workflowId.trim(),
    f.processNames.length,
    f.stepNames.length,
    f.handledByNames.length || f.notHandled,
    f.created[0] || f.created[1],
    f.updated[0] || f.updated[1],
  ].filter(Boolean).length
}

const FMT = 'YYYY-MM-DD HH:mm:ss'

const presets: { label: string; range: () => Range }[] = [
  { label: 'Dzisiaj', range: () => [dayjs().startOf('day').format(FMT), null] },
  { label: 'Ostatnie 24 h', range: () => [dayjs().subtract(24, 'hour').format(FMT), null] },
  { label: 'Ostatnie 7 dni', range: () => [dayjs().subtract(7, 'day').startOf('day').format(FMT), null] },
  { label: 'Ostatnie 30 dni', range: () => [dayjs().subtract(30, 'day').startOf('day').format(FMT), null] },
  { label: 'Starsze niż 7 dni', range: () => [null, dayjs().subtract(7, 'day').endOf('day').format(FMT)] },
  { label: 'Starsze niż 30 dni', range: () => [null, dayjs().subtract(30, 'day').endOf('day').format(FMT)] },
]

const facetData = (values: FacetValue[] | undefined) =>
  (values ?? []).map((v) => ({ value: v.value, label: `${v.value} (${v.count})` }))

interface DateRangeProps {
  label: string
  value: Range
  onChange: (value: Range) => void
}

const DateRangeFilter = memo(function DateRangeFilter({ label, value, onChange }: DateRangeProps) {
  const [from, to] = value
  const invalid = from && to && from > to
  return (
    <Input.Wrapper label={label} error={invalid ? '„Od” jest późniejsze niż „Do”' : undefined}>
      <Group gap={6} wrap="nowrap" align="flex-start">
        <DateTimePicker
          style={{ flex: 1 }}
          placeholder="Od"
          aria-label={`${label} od`}
          value={from}
          onChange={(v) => onChange([v, to])}
          valueFormat="DD.MM.YYYY HH:mm"
          defaultTimeValue="00:00"
          clearable
          error={!!invalid}
        />
        <DateTimePicker
          style={{ flex: 1 }}
          placeholder="Do"
          aria-label={`${label} do`}
          value={to}
          onChange={(v) => onChange([from, v ? v.replace(/:00$/, ':59') : null])}
          valueFormat="DD.MM.YYYY HH:mm"
          defaultTimeValue="23:59"
          clearable
          error={!!invalid}
        />
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="default" size="lg" aria-label="Szybki wybór zakresu">
              <IconCalendar size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {presets.map((p) => (
              <Menu.Item key={p.label} onClick={() => onChange(p.range())}>
                {p.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Input.Wrapper>
  )
})

interface Props {
  value: FilterState
  onChange: (value: FilterState) => void
  facets?: Facets
}

export const FilterPanel = memo(function FilterPanel({ value, onChange, facets }: Props) {
  const set = <K extends keyof FilterState>(key: K, v: FilterState[K]) => onChange({ ...value, [key]: v })

  const processData = useMemo(() => facetData(facets?.processNames), [facets])
  const stepData = useMemo(() => facetData(facets?.stepNames), [facets])
  const handledData = useMemo(() => facetData(facets?.handledByNames), [facets])

  const clearable = (key: 'id' | 'workflowId') =>
    value[key] ? <CloseButton size="sm" onClick={() => set(key, '')} aria-label="Wyczyść" /> : null

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm" verticalSpacing="xs">
      <TextInput
        label="Id zadania"
        placeholder="fragment Id…"
        value={value.id}
        onChange={(e) => set('id', e.currentTarget.value)}
        rightSection={clearable('id')}
      />
      <TextInput
        label="Numer zadania"
        placeholder="np. ZAP-40401"
        value={value.workflowId}
        onChange={(e) => set('workflowId', e.currentTarget.value)}
        rightSection={clearable('workflowId')}
      />
      <DateRangeFilter label="Data utworzenia" value={value.created} onChange={(v) => set('created', v)} />
      <DateRangeFilter label="Data modyfikacji" value={value.updated} onChange={(v) => set('updated', v)} />
      <MultiSelect
        label="Nazwa procesu"
        placeholder={value.processNames.length ? undefined : 'wszystkie'}
        data={processData}
        value={value.processNames}
        onChange={(v) => set('processNames', v)}
        searchable
        clearable
        maxDropdownHeight={320}
      />
      <MultiSelect
        label="Krok procesu"
        placeholder={value.stepNames.length ? undefined : 'wszystkie'}
        data={stepData}
        value={value.stepNames}
        onChange={(v) => set('stepNames', v)}
        searchable
        clearable
        maxDropdownHeight={320}
      />
      <MultiSelect
        label="Pobrane przez"
        placeholder={value.handledByNames.length || value.notHandled ? undefined : 'wszyscy'}
        data={handledData}
        value={value.notHandled ? [] : value.handledByNames}
        onChange={(v) => set('handledByNames', v)}
        disabled={value.notHandled}
        searchable
        clearable
        maxDropdownHeight={320}
      />
      <Checkbox
        mt={{ base: 0, lg: 30 }}
        label="Tylko niepobrane (brak „Pobrane przez”)"
        checked={value.notHandled}
        onChange={(e) => set('notHandled', e.currentTarget.checked)}
      />
    </SimpleGrid>
  )
})
