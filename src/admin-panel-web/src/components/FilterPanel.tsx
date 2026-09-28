import { Checkbox, CloseButton, MultiSelect, SimpleGrid, TextInput } from '@mantine/core'
import { DateTimePicker, type DatesRangeValue } from '@mantine/dates'
import dayjs from 'dayjs'
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
const presets = [
  { label: 'Dzisiaj', value: [dayjs().startOf('day').format(FMT), dayjs().endOf('day').format(FMT)] },
  { label: 'Ostatnie 24 h', value: [dayjs().subtract(24, 'hour').format(FMT), dayjs().endOf('day').format(FMT)] },
  { label: 'Ostatnie 7 dni', value: [dayjs().subtract(7, 'day').startOf('day').format(FMT), dayjs().endOf('day').format(FMT)] },
  { label: 'Ostatnie 30 dni', value: [dayjs().subtract(30, 'day').startOf('day').format(FMT), dayjs().endOf('day').format(FMT)] },
  { label: 'Starsze niż 30 dni', value: [dayjs('2000-01-01').format(FMT), dayjs().subtract(30, 'day').endOf('day').format(FMT)] },
] as { label: string; value: DatesRangeValue<string> }[]

const facetData = (values: FacetValue[] | undefined) =>
  (values ?? []).map((v) => ({ value: v.value, label: `${v.value} (${v.count})` }))

interface Props {
  value: FilterState
  onChange: (value: FilterState) => void
  facets?: Facets
}

export function FilterPanel({ value, onChange, facets }: Props) {
  const set = <K extends keyof FilterState>(key: K, v: FilterState[K]) => onChange({ ...value, [key]: v })

  const dateRange = (key: 'created' | 'updated', label: string) => (
    <DateTimePicker
      type="range"
      label={label}
      placeholder="Od – do"
      value={value[key]}
      // koniec zakresu bez wybranej godziny (00:00) traktujemy jako cały dzień
      onChange={(v) => set(key, [v[0] ?? null, v[1]?.endsWith('00:00:00') ? v[1].replace('00:00:00', '23:59:59') : (v[1] ?? null)])}
      valueFormat="DD.MM.YYYY HH:mm"
      presets={presets}
      clearable
      allowSingleDateInRange
      defaultTimeValue="00:00"
    />
  )

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
      {dateRange('created', 'Data utworzenia')}
      {dateRange('updated', 'Data modyfikacji')}
      <MultiSelect
        label="Nazwa procesu"
        placeholder={value.processNames.length ? undefined : 'wszystkie'}
        data={facetData(facets?.processNames)}
        value={value.processNames}
        onChange={(v) => set('processNames', v)}
        searchable
        clearable
        maxDropdownHeight={320}
      />
      <MultiSelect
        label="Krok procesu"
        placeholder={value.stepNames.length ? undefined : 'wszystkie'}
        data={facetData(facets?.stepNames)}
        value={value.stepNames}
        onChange={(v) => set('stepNames', v)}
        searchable
        clearable
        maxDropdownHeight={320}
      />
      <MultiSelect
        label="Pobrane przez"
        placeholder={value.handledByNames.length || value.notHandled ? undefined : 'wszyscy'}
        data={facetData(facets?.handledByNames)}
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
}
