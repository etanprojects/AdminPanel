import dayjs from 'dayjs'

export function formatDate(value?: string): string {
  if (!value) return ''
  const d = dayjs(value.replace(/(\.\d{3})\d+/, '$1'))
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : value
}

export const toApiDate = (value: string | null | undefined) =>
  value ? value.replace(' ', 'T') : undefined

const CSV_SEP = ';'
const BOM = String.fromCharCode(0xfeff)

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return /[;"\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsv(header: string[], rows: unknown[][]): Blob {
  const lines = [header, ...rows].map((r) => r.map(csvEscape).join(CSV_SEP))
  return new Blob([BOM + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const timestamp = () => dayjs().format('YYYYMMDD_HHmmss')

export const plural = (n: number, one: string, few: string, many: string) => {
  if (n === 1) return one
  const d = n % 10
  const t = n % 100
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many
}
