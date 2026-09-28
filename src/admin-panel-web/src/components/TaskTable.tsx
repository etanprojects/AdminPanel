import { Center, Checkbox, Group, LoadingOverlay, Text } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconSelector } from '../icons'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useMemo, useRef } from 'react'
import type { Sort, SortField, TaskDto, TaskRef } from '../types'
import { formatDate } from '../utils'

const ROW_HEIGHT = 34

const columns: { field: SortField; label: string; width: string; mono?: boolean; value: (t: TaskDto) => string | undefined }[] = [
  { field: 'id', label: 'Id zadania', width: '300px', mono: true, value: (t) => t.id },
  { field: 'createdAt', label: 'Data utworzenia', width: '160px', value: (t) => formatDate(t.createdAt) },
  { field: 'updatedAt', label: 'Data modyfikacji', width: '160px', value: (t) => formatDate(t.updatedAt) },
  { field: 'workflowId', label: 'Numer zadania', width: '130px', value: (t) => t.workflowId },
  { field: 'processName', label: 'Nazwa procesu', width: '30%', value: (t) => t.processName },
  { field: 'currentStepName', label: 'Krok procesu', width: '25%', value: (t) => t.currentStepName },
  { field: 'handledByName', label: 'Pobrane przez', width: '190px', value: (t) => t.handledByName },
]

export const toRef = (t: TaskDto): TaskRef => ({
  id: t.id,
  workflowId: t.workflowId,
  instanceId: t.instanceId,
  processId: t.processId,
})

interface Props {
  items: TaskDto[]
  loading: boolean
  sort: Sort
  onSort: (sort: Sort) => void
  selected: Map<string, TaskRef>
  onToggle: (tasks: TaskDto[], checked: boolean) => void
  onOpen: (task: TaskDto) => void
  emptyMessage?: string
}

export const TaskTable = memo(function TaskTable({ items, loading, sort, onSort, selected, onToggle, onOpen, emptyMessage }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  const selectedCount = useMemo(
    () => (selected.size === 0 ? 0 : items.reduce((n, t) => n + (selected.has(t.id) ? 1 : 0), 0)),
    [items, selected],
  )
  const allSelected = items.length > 0 && selectedCount === items.length

  const sortIcon = (field: SortField) => {
    if (sort.field !== field) return <IconSelector size={14} opacity={0.4} />
    return sort.dir === 'asc' ? <IconArrowUp size={14} /> : <IconArrowDown size={14} />
  }

  const virtualRows = virtualizer.getVirtualItems()
  const padTop = virtualRows.length ? virtualRows[0].start : 0
  const padBottom = virtualRows.length ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0

  return (
    <div ref={scrollRef} className="task-scroll">
      <LoadingOverlay visible={loading} zIndex={5} overlayProps={{ backgroundOpacity: 0.3 }} transitionProps={{ duration: 0 }} />
      <table className="task-table">
        <colgroup>
          <col style={{ width: 40 }} />
          {columns.map((c) => (
            <col key={c.field} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>
              <Checkbox
                aria-label="Zaznacz wszystkie na liście"
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                onChange={() => onToggle(items, !allSelected)}
              />
            </th>
            {columns.map((c) => (
              <th
                key={c.field}
                data-sortable
                onClick={() => onSort({ field: c.field, dir: sort.field === c.field && sort.dir === 'desc' ? 'asc' : 'desc' })}
              >
                <Group gap={4} wrap="nowrap">
                  {c.label}
                  {sortIcon(c.field)}
                </Group>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr>
              <td colSpan={columns.length + 1} style={{ height: padTop, padding: 0 }} />
            </tr>
          )}
          {virtualRows.map((v) => {
            const t = items[v.index]
            return (
              <Row
                key={t.id}
                task={t}
                odd={v.index % 2 === 1}
                selected={selected.has(t.id)}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            )
          })}
          {padBottom > 0 && (
            <tr>
              <td colSpan={columns.length + 1} style={{ height: padBottom, padding: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
      {!loading && items.length === 0 && (
        <Center py="xl">
          <Text c="dimmed" ta="center" maw={520}>
            {emptyMessage ?? 'Brak zadań spełniających kryteria.'}
          </Text>
        </Center>
      )}
    </div>
  )
})

const Row = memo(function Row({
  task,
  odd,
  selected,
  onToggle,
  onOpen,
}: {
  task: TaskDto
  odd: boolean
  selected: boolean
  onToggle: Props['onToggle']
  onOpen: Props['onOpen']
}) {
  return (
    <tr
      style={{ height: ROW_HEIGHT }}
      data-odd={odd || undefined}
      data-selected={selected || undefined}
      onClick={() => onOpen(task)}
    >
      <td onClick={(e) => e.stopPropagation()}>
        <Checkbox aria-label="Zaznacz zadanie" checked={selected} onChange={(e) => onToggle([task], e.currentTarget.checked)} />
      </td>
      {columns.map((c) => {
        const value = c.value(task)
        return (
          <td key={c.field} className={c.mono ? 'mono' : undefined} title={value}>
            {value ?? <span className="dim">—</span>}
          </td>
        )
      })}
    </tr>
  )
})
