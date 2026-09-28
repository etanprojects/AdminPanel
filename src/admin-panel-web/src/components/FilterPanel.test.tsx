import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithMantine } from '../test/render'
import { countActiveFilters, emptyFilters, FilterPanel, toTaskFilter, type FilterState } from './FilterPanel'

const withFilters = (patch: Partial<FilterState>): FilterState => ({ ...emptyFilters, ...patch })

describe('toTaskFilter', () => {
  it('returns only undefined values for empty filters and query', () => {
    const filter = toTaskFilter(emptyFilters, '   ')
    expect(Object.values(filter).every((v) => v === undefined)).toBe(true)
  })

  it('trims text fields and query', () => {
    const filter = toTaskFilter(withFilters({ id: '  abc ', workflowId: ' ZAP-1 ' }), ' state:2001 ')
    expect(filter).toMatchObject({ id: 'abc', workflowId: 'ZAP-1', query: 'state:2001' })
  })

  it('supports only "from" date', () => {
    const filter = toTaskFilter(withFilters({ created: ['2025-10-01 00:00:00', null] }), '')
    expect(filter.createdFrom).toBe('2025-10-01T00:00:00')
    expect(filter.createdTo).toBeUndefined()
  })

  it('supports only "to" date', () => {
    const filter = toTaskFilter(withFilters({ updated: [null, '2025-10-31 23:59:59'] }), '')
    expect(filter.updatedFrom).toBeUndefined()
    expect(filter.updatedTo).toBe('2025-10-31T23:59:59')
  })

  it('supports both dates', () => {
    const filter = toTaskFilter(withFilters({ created: ['2025-10-01 00:00:00', '2025-10-31 23:59:59'] }), '')
    expect(filter).toMatchObject({ createdFrom: '2025-10-01T00:00:00', createdTo: '2025-10-31T23:59:59' })
  })

  it('ignores selected handlers when "not handled" is checked', () => {
    const filter = toTaskFilter(withFilters({ handledByNames: ['Nowak Piotr'], notHandled: true }), '')
    expect(filter.handledByNames).toBeUndefined()
    expect(filter.notHandled).toBe(true)
  })

  it('omits empty multi-select lists', () => {
    const filter = toTaskFilter(withFilters({ processNames: [], stepNames: ['Rejestracja'] }), '')
    expect(filter.processNames).toBeUndefined()
    expect(filter.stepNames).toEqual(['Rejestracja'])
  })
})

describe('countActiveFilters', () => {
  it('is zero for empty filters', () => {
    expect(countActiveFilters(emptyFilters)).toBe(0)
  })

  it('counts each filter group once', () => {
    const count = countActiveFilters(
      withFilters({
        id: 'a',
        processNames: ['x', 'y'],
        handledByNames: ['n'],
        notHandled: true,
        created: [null, '2025-01-01 00:00:00'],
      }),
    )
    expect(count).toBe(4)
  })

  it('ignores whitespace-only text', () => {
    expect(countActiveFilters(withFilters({ workflowId: '   ' }))).toBe(0)
  })
})

describe('FilterPanel', () => {
  it('renders separate "Od" and "Do" inputs for both date filters', () => {
    renderWithMantine(<FilterPanel value={emptyFilters} onChange={() => {}} />)
    expect(screen.getByLabelText('Data utworzenia od')).toBeTruthy()
    expect(screen.getByLabelText('Data utworzenia do')).toBeTruthy()
    expect(screen.getByLabelText('Data modyfikacji od')).toBeTruthy()
    expect(screen.getByLabelText('Data modyfikacji do')).toBeTruthy()
  })

  it('reports text changes with the rest of the state untouched', () => {
    const onChange = vi.fn()
    const value = withFilters({ stepNames: ['Rejestracja'] })
    renderWithMantine(<FilterPanel value={value} onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('np. ZAP-40401'), { target: { value: 'ZAP-7' } })
    expect(onChange).toHaveBeenCalledWith({ ...value, workflowId: 'ZAP-7' })
  })

  it('shows validation message when "Od" is later than "Do"', () => {
    renderWithMantine(
      <FilterPanel value={withFilters({ created: ['2025-10-10 00:00:00', '2025-10-01 23:59:59'] })} onChange={() => {}} />,
    )
    expect(screen.getByText('„Od” jest późniejsze niż „Do”')).toBeTruthy()
  })

  it('applies a quick range from the calendar menu', () => {
    const onChange = vi.fn()
    renderWithMantine(<FilterPanel value={emptyFilters} onChange={onChange} />)
    fireEvent.click(screen.getAllByLabelText('Szybki wybór zakresu')[0])
    fireEvent.click(screen.getByText('Starsze niż 30 dni'))
    const next = onChange.mock.calls[0][0] as FilterState
    expect(next.created[0]).toBeNull()
    expect(next.created[1]).toMatch(/^\d{4}-\d{2}-\d{2} 23:59:59$/)
  })
})
