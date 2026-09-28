import { describe, expect, it } from 'vitest'
import { buildCsv, formatDate, plural, toApiDate } from './utils'

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })

describe('formatDate', () => {
  it('formats index dates with 7 fractional digits', () => {
    expect(formatDate('2025-10-03T12:59:40.7566670')).toBe('2025-10-03 12:59:40')
  })

  it('returns empty string for missing value', () => {
    expect(formatDate(undefined)).toBe('')
    expect(formatDate('')).toBe('')
  })

  it('returns the original text when the value is not a date', () => {
    expect(formatDate('not a date')).toBe('not a date')
  })
})

describe('toApiDate', () => {
  it('converts picker format to ISO local date-time', () => {
    expect(toApiDate('2025-10-03 12:30:59')).toBe('2025-10-03T12:30:59')
  })

  it('maps empty values to undefined', () => {
    expect(toApiDate(null)).toBeUndefined()
    expect(toApiDate(undefined)).toBeUndefined()
    expect(toApiDate('')).toBeUndefined()
  })
})

describe('buildCsv', () => {
  it('starts with UTF-8 BOM and uses semicolon separator with CRLF line endings', async () => {
    const text = await readBlob(buildCsv(['Id zadania', 'Status'], [['a1', 200]]))
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text.slice(1)).toBe('Id zadania;Status\r\na1;200\r\n')
  })

  it('quotes values containing separators, quotes and new lines', async () => {
    const text = await readBlob(buildCsv(['x'], [['a;b'], ['say "hi"'], ['line1\nline2']]))
    expect(text.slice(1).split('\r\n').slice(1, 4)).toEqual(['"a;b"', '"say ""hi"""', '"line1\nline2"'])
  })

  it('neutralizes spreadsheet formulas', async () => {
    const text = await readBlob(buildCsv(['x'], [['=SUM(A1)'], ['-5']]))
    expect(text.slice(1).split('\r\n').slice(1, 3)).toEqual([`"'=SUM(A1)"`, `"'-5"`])
  })

  it('writes null and undefined as empty cells', async () => {
    const text = await readBlob(buildCsv(['a', 'b'], [[null, undefined]]))
    expect(text.slice(1).split('\r\n')[1]).toBe(';')
  })
})

describe('plural', () => {
  it.each([
    [1, 'zadanie'],
    [2, 'zadania'],
    [4, 'zadania'],
    [5, 'zadań'],
    [12, 'zadań'],
    [14, 'zadań'],
    [22, 'zadania'],
    [25, 'zadań'],
    [0, 'zadań'],
  ])('%i -> %s', (n, expected) => {
    expect(plural(n, 'zadanie', 'zadania', 'zadań')).toBe(expected)
  })
})
