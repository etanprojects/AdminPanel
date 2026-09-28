import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, watchJob } from '../api'
import { renderWithMantine } from '../test/render'
import type { ActionInfo, JobProgress, JobSnapshot, TaskRef } from '../types'
import { ActionRunner } from './ActionRunner'

vi.mock('../api', () => ({
  api: { startJob: vi.fn(), cancelJob: vi.fn() },
  watchJob: vi.fn(),
}))

const action: ActionInfo = {
  key: 'finish-as-administrator',
  name: 'Zakończ jako administrator',
  method: 'POST',
  url: 'https://inna.aplikacja/process-instances/finish-as-administrator',
  body: { id: '{{task.id}}', isReject: '{{param.isReject}}', comment: '{{param.comment}}' },
  auth: 'PassThrough',
  parallelism: 4,
  parameters: [
    { name: 'isReject', label: 'Odrzuć (isReject)', type: 'boolean', default: false },
    { name: 'comment', label: 'Komentarz', type: 'textarea', required: true },
  ],
}

const tasks: TaskRef[] = [
  { id: 'task-1', workflowId: 'ZAP-1' },
  { id: 'task-2', workflowId: 'ZAP-2' },
]

type Handlers = Parameters<typeof watchJob>[1]

const snapshot = (patch: Partial<JobSnapshot> = {}): JobSnapshot => ({
  jobId: 'job-1',
  actionKey: action.key,
  actionName: action.name,
  total: 2,
  state: 'Running',
  processed: 0,
  succeeded: 0,
  failed: 0,
  startedBy: 'tester',
  startedAt: new Date().toISOString(),
  results: [],
  ...patch,
})

let handlers: Handlers

beforeEach(() => {
  vi.mocked(watchJob).mockImplementation(async (_jobId, h) => {
    handlers = h
    return async () => {}
  })
})

const setup = (props: Partial<Parameters<typeof ActionRunner>[0]> = {}) => {
  const onClose = vi.fn()
  const onSelectTasks = vi.fn()
  renderWithMantine(<ActionRunner action={action} tasks={tasks} onClose={onClose} onSelectTasks={onSelectTasks} {...props} />)
  return { onClose, onSelectTasks }
}

const runButton = () => screen.getByRole('button', { name: 'Uruchom' }) as HTMLButtonElement

const fillAndConfirm = async () => {
  await userEvent.type(screen.getByLabelText(/Komentarz/), 'test')
  await userEvent.click(screen.getByLabelText(/Potwierdzam wykonanie akcji/))
}

describe('ActionRunner - configuration', () => {
  it('blocks "Uruchom" and explains why', () => {
    setup()
    expect(runButton().disabled).toBe(true)
    expect(screen.getByText('Aby uruchomić: uzupełnij „Komentarz”, zaznacz potwierdzenie')).toBeTruthy()
  })

  it('enables "Uruchom" after filling required parameter and confirming', async () => {
    setup()
    await fillAndConfirm()
    expect(runButton().disabled).toBe(false)
    expect(screen.queryByText(/Aby uruchomić/)).toBeNull()
  })

  it('still requires confirmation when parameters are filled', async () => {
    setup()
    await userEvent.type(screen.getByLabelText(/Komentarz/), 'test')
    expect(runButton().disabled).toBe(true)
    expect(screen.getByText('Aby uruchomić: zaznacz potwierdzenie')).toBeTruthy()
  })

  it('confirmation checkbox can be toggled repeatedly', async () => {
    setup()
    const confirm = screen.getByLabelText(/Potwierdzam wykonanie akcji/) as HTMLInputElement
    await userEvent.click(confirm)
    await userEvent.click(confirm)
    await userEvent.click(confirm)
    expect(confirm.checked).toBe(true)
  })

  it('previews request body for the first task and reacts to every switch click', async () => {
    setup()
    const preview = () => screen.getByText(/POST https:\/\/inna\.aplikacja/).textContent ?? ''
    expect(preview()).toContain('"id": "task-1"')
    expect(preview()).toContain('"isReject": false')

    const toggle = screen.getByLabelText('Odrzuć (isReject)')
    await userEvent.click(toggle)
    expect(preview()).toContain('"isReject": true')
    await userEvent.click(toggle)
    expect(preview()).toContain('"isReject": false')
    await userEvent.click(toggle)
    expect(preview()).toContain('"isReject": true')
  })

  it('closes without running on "Anuluj"', async () => {
    const { onClose } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    expect(onClose).toHaveBeenCalledWith(false)
    expect(api.startJob).not.toHaveBeenCalled()
  })

  it('shows a message when no tasks are selected', () => {
    setup({ tasks: [] })
    expect(screen.getByText('Nie zaznaczono żadnych zadań.')).toBeTruthy()
    expect(runButton().disabled).toBe(true)
  })

  it('shows server error when the job cannot be started', async () => {
    vi.mocked(api.startJob).mockRejectedValue(new Error('Parametr "Komentarz" jest wymagany.'))
    setup()
    await fillAndConfirm()
    await userEvent.click(runButton())
    expect(await screen.findByText('Parametr "Komentarz" jest wymagany.')).toBeTruthy()
  })
})

describe('ActionRunner - execution', () => {
  it('starts the job with parameters and selected tasks', async () => {
    vi.mocked(api.startJob).mockResolvedValue({ jobId: 'job-1' })
    setup()
    await fillAndConfirm()
    await userEvent.click(runButton())

    expect(api.startJob).toHaveBeenCalledWith(action.key, { isReject: false, comment: 'test' }, tasks)
    await waitFor(() => expect(watchJob).toHaveBeenCalledWith('job-1', expect.anything()))
  })

  it('shows progress, summary and lets select failed tasks', async () => {
    vi.mocked(api.startJob).mockResolvedValue({ jobId: 'job-1' })
    const { onSelectTasks, onClose } = setup()
    await fillAndConfirm()
    await userEvent.click(runButton())
    await waitFor(() => expect(watchJob).toHaveBeenCalled())

    act(() => handlers.onSnapshot(snapshot()))
    const ok = { index: 0, id: 'task-1', workflowId: 'ZAP-1', success: true, statusCode: 200, durationMs: 5 }
    const failed = { index: 1, id: 'task-2', workflowId: 'ZAP-2', success: false, statusCode: 409, error: 'HTTP 409 Conflict: Zadanie jest już zakończone', durationMs: 7 }
    const progress = (p: Partial<JobProgress>): JobProgress => ({ jobId: 'job-1', state: 'Running', processed: 0, succeeded: 0, failed: 0, total: 2, ...p })

    act(() => handlers.onProgress(progress({ processed: 1, succeeded: 1, result: ok })))
    expect(screen.getByText(/Wykonywanie… 1 \/ 2/)).toBeTruthy()

    act(() => handlers.onProgress(progress({ processed: 2, succeeded: 1, failed: 1, result: failed })))
    act(() => handlers.onFinished(progress({ state: 'Completed', processed: 2, succeeded: 1, failed: 1 })))

    expect(await screen.findByText(/Zakończono 2 \/ 2/)).toBeTruthy()
    expect(await screen.findByText('HTTP 409 Conflict: Zadanie jest już zakończone')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Zaznacz błędne i niewykonane \(1\)/ }))
    expect(onSelectTasks).toHaveBeenCalledWith([tasks[1]])
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('cancels a running job', async () => {
    vi.mocked(api.startJob).mockResolvedValue({ jobId: 'job-1' })
    vi.mocked(api.cancelJob).mockResolvedValue(new Response(null, { status: 202 }))
    setup()
    await fillAndConfirm()
    await userEvent.click(runButton())
    await waitFor(() => expect(watchJob).toHaveBeenCalled())
    act(() => handlers.onSnapshot(snapshot()))

    await userEvent.click(screen.getByRole('button', { name: 'Przerwij' }))
    expect(api.cancelJob).toHaveBeenCalledWith('job-1')
  })

  it('reports tasks not processed after cancellation', async () => {
    vi.mocked(api.startJob).mockResolvedValue({ jobId: 'job-1' })
    setup()
    await fillAndConfirm()
    await userEvent.click(runButton())
    await waitFor(() => expect(watchJob).toHaveBeenCalled())

    act(() =>
      handlers.onSnapshot(
        snapshot({
          state: 'Cancelled',
          processed: 1,
          succeeded: 1,
          finishedAt: new Date().toISOString(),
          results: [{ index: 0, id: 'task-1', workflowId: 'ZAP-1', success: true, statusCode: 200, durationMs: 3 }],
        }),
      ),
    )

    expect(await screen.findByText(/Przerwano 1 \/ 2/)).toBeTruthy()
    expect(screen.getByText('Niewykonane')).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Zaznacz błędne i niewykonane \(1\)/ })).toBeTruthy()
  })
})

describe('ActionRunner - existing job', () => {
  it('subscribes to the job without showing configuration', async () => {
    setup({ action: undefined, tasks: undefined, jobId: 'job-9' })
    await waitFor(() => expect(watchJob).toHaveBeenCalledWith('job-9', expect.anything()))
    act(() => handlers.onSnapshot(snapshot({ jobId: 'job-9', state: 'Completed', processed: 2, succeeded: 2, finishedAt: new Date().toISOString() })))

    expect(await screen.findByText(/Zakończono 2 \/ 2/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Uruchom' })).toBeNull()
    expect(screen.getByText(action.name)).toBeTruthy()
  })

  it('shows an error when the job does not exist', async () => {
    vi.mocked(watchJob).mockRejectedValue(new Error('Nie znaleziono joba job-x'))
    setup({ action: undefined, tasks: undefined, jobId: 'job-x' })
    expect(await screen.findByText('Nie znaleziono joba job-x')).toBeTruthy()
  })

  it('downloads the result file', async () => {
    const createObjectURL = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    setup({ action: undefined, tasks: undefined, jobId: 'job-9' })
    await waitFor(() => expect(watchJob).toHaveBeenCalled())
    act(() =>
      handlers.onSnapshot(
        snapshot({
          state: 'Completed',
          processed: 1,
          failed: 1,
          total: 1,
          finishedAt: new Date().toISOString(),
          results: [{ index: 0, id: 'task-2', workflowId: 'ZAP-2', success: false, statusCode: 500, error: 'boom', durationMs: 1 }],
        }),
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: /Zapisz wynik/ }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
  })
})
