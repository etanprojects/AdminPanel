import { getAccessToken } from './auth'
import type {
  ActionInfo,
  AppConfig,
  Facets,
  JobProgress,
  JobSnapshot,
  ParameterValue,
  Sort,
  TaskFilter,
  TaskRef,
  TaskRefsResult,
  TaskSearchResult,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const resp = await fetch(path, { ...init, headers })
  if (resp.status === 401 && retry && token) {
    await getAccessToken(true)
    return request(path, init, false)
  }
  if (!resp.ok) throw new ApiError(resp.status, await errorMessage(resp))
  return resp
}

async function errorMessage(resp: Response): Promise<string> {
  const text = await resp.text()
  try {
    const json = JSON.parse(text)
    return json.detail ?? json.error ?? json.title ?? text
  } catch {
    return text || `HTTP ${resp.status}`
  }
}

const post = async <T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> =>
  (await request(path, { method: 'POST', body: JSON.stringify(body), signal })).json()

const get = async <T>(path: string): Promise<T> => (await request(path)).json()

export const api = {
  config: async (): Promise<AppConfig> => (await fetch('api/config')).json(),

  search: (filter: TaskFilter, page: number, pageSize: number, sort: Sort, signal?: AbortSignal) =>
    post<TaskSearchResult>(
      'api/tasks/search',
      { filter, page, pageSize, sortField: sort.field, sortDir: sort.dir },
      signal,
    ),

  refs: (filter: TaskFilter) => post<TaskRefsResult>('api/tasks/refs', filter),

  facets: () => get<Facets>('api/tasks/facets'),

  raw: (id: string) => get<unknown>(`api/tasks/${encodeURIComponent(id)}/raw`),

  actions: () => get<ActionInfo[]>('api/actions'),

  exportCsv: async (filter: TaskFilter, sort: Sort) => {
    const resp = await request('api/tasks/export', {
      method: 'POST',
      body: JSON.stringify({ filter, sortField: sort.field, sortDir: sort.dir }),
    })
    const name =
      /filename="?([^";]+)"?/.exec(resp.headers.get('Content-Disposition') ?? '')?.[1] ?? 'zadania.csv'
    return { blob: await resp.blob(), name }
  },

  startJob: (actionKey: string, parameters: Record<string, ParameterValue>, tasks: TaskRef[]) =>
    post<{ jobId: string }>(`api/actions/${encodeURIComponent(actionKey)}/jobs`, { parameters, tasks }),

  jobs: () => get<JobSnapshot[]>('api/jobs'),

  cancelJob: (jobId: string) => request(`api/jobs/${jobId}/cancel`, { method: 'POST' }),
}

export async function watchJob(
  jobId: string,
  handlers: {
    onSnapshot: (s: JobSnapshot) => void
    onProgress: (p: JobProgress) => void
    onFinished: (p: JobProgress) => void
    onConnection?: (state: 'connected' | 'reconnecting' | 'disconnected') => void
  },
): Promise<() => Promise<void>> {
  const { HubConnectionBuilder, LogLevel } = await import('@microsoft/signalr')
  const connection = new HubConnectionBuilder()
    .withUrl('hubs/jobs', { accessTokenFactory: async () => (await getAccessToken()) ?? '' })
    .withAutomaticReconnect([0, 1000, 2000, 5000, 10000, 10000, 30000])
    .configureLogging(LogLevel.Warning)
    .build()

  connection.on('progress', handlers.onProgress)
  connection.on('finished', handlers.onFinished)

  const subscribe = async () => {
    const snapshot = await connection.invoke<JobSnapshot | null>('Subscribe', jobId)
    if (!snapshot) throw new Error('Nie znaleziono joba ' + jobId)
    handlers.onSnapshot(snapshot)
  }

  connection.onreconnecting(() => handlers.onConnection?.('reconnecting'))
  connection.onreconnected(async () => {
    handlers.onConnection?.('connected')
    await subscribe()
  })
  connection.onclose(() => handlers.onConnection?.('disconnected'))

  await connection.start()
  handlers.onConnection?.('connected')
  await subscribe()
  return () => connection.stop()
}
