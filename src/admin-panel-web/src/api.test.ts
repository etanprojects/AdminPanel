import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, body: init?.body ? JSON.parse(init.body as string) : undefined }
}

describe('api.search', () => {
  it('posts filter, paging and sort to a relative URL', async () => {
    fetchMock.mockResolvedValue(json({ total: 1, items: [{ id: 'a' }] }))
    const result = await api.search({ query: 'x' }, 1, 10000, { field: 'updatedAt', dir: 'asc' })

    const { url, init, body } = lastCall()
    expect(url).toBe('api/tasks/search')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(body).toEqual({ filter: { query: 'x' }, page: 1, pageSize: 10000, sortField: 'updatedAt', sortDir: 'asc' })
    expect(result.total).toBe(1)
  })

  it('does not send Authorization header when auth is disabled', async () => {
    fetchMock.mockResolvedValue(json({ total: 0, items: [] }))
    await api.search({}, 1, 10, { field: 'createdAt', dir: 'desc' })
    expect(new Headers(lastCall().init.headers).has('Authorization')).toBe(false)
  })

  it('throws ApiError with ProblemDetails detail', async () => {
    fetchMock.mockResolvedValue(json({ title: 'Bad Request', detail: 'Zła składnia zapytania' }, { status: 400 }))
    const error = await api.search({}, 1, 10, { field: 'createdAt', dir: 'desc' }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.message).toBe('Zła składnia zapytania')
  })

  it('falls back to plain text error body', async () => {
    fetchMock.mockResolvedValue(new Response('upstream down', { status: 502 }))
    await expect(api.search({}, 1, 10, { field: 'createdAt', dir: 'desc' })).rejects.toThrow('upstream down')
  })

  it('uses "error" property when present', async () => {
    fetchMock.mockResolvedValue(json({ error: 'Nieznana akcja: x' }, { status: 404 }))
    await expect(api.startJob('x', {}, [{ id: '1' }])).rejects.toThrow('Nieznana akcja: x')
  })
})

describe('api.startJob', () => {
  it('posts parameters and task refs for the action', async () => {
    fetchMock.mockResolvedValue(json({ jobId: 'j1' }))
    const result = await api.startJob('finish as admin', { isReject: true, comment: 'c' }, [{ id: 't1', workflowId: 'ZAP-1' }])

    const { url, body } = lastCall()
    expect(url).toBe('api/actions/finish%20as%20admin/jobs')
    expect(body).toEqual({ parameters: { isReject: true, comment: 'c' }, tasks: [{ id: 't1', workflowId: 'ZAP-1' }] })
    expect(result.jobId).toBe('j1')
  })
})

describe('api.exportCsv', () => {
  it('returns blob and file name from Content-Disposition', async () => {
    fetchMock.mockResolvedValue(
      new Response('Id zadania\r\n', { headers: { 'Content-Disposition': 'attachment; filename="zadania_20260928.csv"' } }),
    )
    const { name, blob } = await api.exportCsv({ ids: ['a'] }, { field: 'createdAt', dir: 'desc' })
    expect(name).toBe('zadania_20260928.csv')
    expect(blob.size).toBeGreaterThan(0)
    expect(lastCall().body).toEqual({ filter: { ids: ['a'] }, sortField: 'createdAt', sortDir: 'desc' })
  })

  it('uses default file name when header is missing', async () => {
    fetchMock.mockResolvedValue(new Response('x'))
    const { name } = await api.exportCsv({}, { field: 'createdAt', dir: 'desc' })
    expect(name).toBe('zadania.csv')
  })
})

describe('api urls', () => {
  it('encodes task id in raw document URL', async () => {
    fetchMock.mockResolvedValue(json({}))
    await api.raw('a/b c')
    expect(lastCall().url).toBe('api/tasks/a%2Fb%20c/raw')
  })

  it('cancels job with POST', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
    await api.cancelJob('j1')
    expect(lastCall().url).toBe('api/jobs/j1/cancel')
    expect(lastCall().init.method).toBe('POST')
  })
})
