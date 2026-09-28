import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithMantine } from '../test/render'
import { QueryBar } from './QueryBar'

const setup = (props: Partial<Parameters<typeof QueryBar>[0]> = {}) => {
  const handlers = { onSearch: vi.fn(), onToggleFilters: vi.fn(), onClear: vi.fn() }
  renderWithMantine(<QueryBar query="" filtersOpen activeFilters={0} {...handlers} {...props} />)
  return { ...handlers, input: screen.getByLabelText('Query string') as HTMLInputElement }
}

describe('QueryBar', () => {
  it('searches when the "Szukaj" button is clicked', async () => {
    const { onSearch, input } = setup()
    await userEvent.type(input, 'state:2001')
    await userEvent.click(screen.getByRole('button', { name: 'Szukaj' }))
    expect(onSearch).toHaveBeenCalledWith('state:2001')
  })

  it('searches when Enter is pressed', async () => {
    const { onSearch, input } = setup()
    await userEvent.type(input, 'ZAP-1{Enter}')
    expect(onSearch).toHaveBeenCalledWith('ZAP-1')
  })

  it('does not search while typing', async () => {
    const { onSearch, input } = setup()
    await userEvent.type(input, 'abc')
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('toggles filters without submitting the form', async () => {
    const { onSearch, onToggleFilters } = setup()
    await userEvent.click(screen.getByRole('button', { name: /Filtry/ }))
    expect(onToggleFilters).toHaveBeenCalledTimes(1)
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('clears input and filters', async () => {
    const { onClear, onSearch, input } = setup({ activeFilters: 2 })
    await userEvent.type(input, 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść wszystkie filtry' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onSearch).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })

  it('disables clear button when there is nothing to clear', () => {
    setup()
    expect((screen.getByRole('button', { name: 'Wyczyść wszystkie filtry' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows active filters count', () => {
    setup({ activeFilters: 3 })
    expect(screen.getByRole('button', { name: /Filtry/ }).textContent).toContain('3')
  })

  it('syncs input with externally changed query', () => {
    const handlers = { onSearch: vi.fn(), onToggleFilters: vi.fn(), onClear: vi.fn() }
    const { rerender } = renderWithMantine(<QueryBar query="a" filtersOpen activeFilters={0} {...handlers} />)
    const input = screen.getByLabelText('Query string') as HTMLInputElement
    expect(input.value).toBe('a')
    fireEvent.change(input, { target: { value: 'local' } })
    rerender(<QueryBar query="" filtersOpen activeFilters={0} {...handlers} />)
    expect(input.value).toBe('')
  })
})
