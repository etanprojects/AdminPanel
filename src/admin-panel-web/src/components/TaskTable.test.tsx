import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithMantine } from '../test/render'
import type { TaskDto, TaskRef } from '../types'
import { TaskTable, toRef } from './TaskTable'

const tasks: TaskDto[] = [
  { id: 'a', workflowId: 'ZAP-1', instanceId: 'i-a', processId: 'p-a', createdAt: '2025-10-03T12:00:00.0000000' },
  { id: 'b', workflowId: 'ZAP-2' },
]

const setup = (props: Partial<Parameters<typeof TaskTable>[0]> = {}) => {
  const handlers = { onSort: vi.fn(), onToggle: vi.fn(), onOpen: vi.fn() }
  renderWithMantine(
    <TaskTable
      items={tasks}
      loading={false}
      sort={{ field: 'createdAt', dir: 'desc' }}
      selected={new Map<string, TaskRef>()}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('toRef', () => {
  it('keeps only fields needed by actions', () => {
    expect(toRef({ ...tasks[0], processName: 'P', handledByName: 'H' })).toEqual({
      id: 'a',
      workflowId: 'ZAP-1',
      instanceId: 'i-a',
      processId: 'p-a',
    })
  })
})

describe('TaskTable', () => {
  it('renders column headers in Polish', () => {
    setup()
    for (const label of ['Id zadania', 'Data utworzenia', 'Data modyfikacji', 'Numer zadania', 'Nazwa procesu', 'Krok procesu', 'Pobrane przez'])
      expect(screen.getByText(label)).toBeTruthy()
  })

  it('selects all listed tasks from the header checkbox', () => {
    const { onToggle } = setup()
    fireEvent.click(screen.getByLabelText('Zaznacz wszystkie na liście'))
    expect(onToggle).toHaveBeenCalledWith(tasks, true)
  })

  it('unselects all when every task is already selected', () => {
    const selected = new Map(tasks.map((t) => [t.id, toRef(t)]))
    const { onToggle } = setup({ selected })
    const header = screen.getByLabelText('Zaznacz wszystkie na liście') as HTMLInputElement
    expect(header.checked).toBe(true)
    fireEvent.click(header)
    expect(onToggle).toHaveBeenCalledWith(tasks, false)
  })

  it('marks header checkbox as indeterminate for partial selection', () => {
    setup({ selected: new Map([['a', toRef(tasks[0])]]) })
    const header = screen.getByLabelText('Zaznacz wszystkie na liście') as HTMLInputElement
    expect(header.checked).toBe(false)
    expect(header.indeterminate).toBe(true)
  })

  it('toggles sort direction on the active column', () => {
    const { onSort } = setup()
    fireEvent.click(screen.getByText('Data utworzenia'))
    expect(onSort).toHaveBeenCalledWith({ field: 'createdAt', dir: 'asc' })
  })

  it('sorts a new column descending first', () => {
    const { onSort } = setup()
    fireEvent.click(screen.getByText('Numer zadania'))
    expect(onSort).toHaveBeenCalledWith({ field: 'workflowId', dir: 'desc' })
  })

  it('shows custom message instead of the list when there are no criteria', () => {
    setup({ items: [], emptyMessage: 'Ustaw co najmniej jeden filtr' })
    expect(screen.getByText('Ustaw co najmniej jeden filtr')).toBeTruthy()
  })

  it('shows default empty message for an empty result', () => {
    setup({ items: [] })
    expect(screen.getByText('Brak zadań spełniających kryteria.')).toBeTruthy()
  })

  it('hides empty message while loading', () => {
    setup({ items: [], loading: true })
    expect(screen.queryByText('Brak zadań spełniających kryteria.')).toBeNull()
  })
})
