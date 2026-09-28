export interface AppConfig {
  auth: { enabled: boolean; authority: string; clientId: string; scope: string }
  sampleData: boolean
  maxBulkResults: number
}

export interface TaskFilter {
  query?: string
  id?: string
  workflowId?: string
  ids?: string[]
  processNames?: string[]
  stepNames?: string[]
  handledByNames?: string[]
  notHandled?: boolean
  createdFrom?: string
  createdTo?: string
  updatedFrom?: string
  updatedTo?: string
}

export type SortField =
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'workflowId'
  | 'processName'
  | 'currentStepName'
  | 'handledByName'

export interface Sort {
  field: SortField
  dir: 'asc' | 'desc'
}

export interface TaskDto {
  id: string
  instanceId?: string
  processId?: string
  createdAt?: string
  updatedAt?: string
  workflowId?: string
  processName?: string
  currentStepName?: string
  handledBy?: string
  handledByName?: string
  state?: number
  status?: number
}

export interface TaskRef {
  id: string
  workflowId?: string
  instanceId?: string
  processId?: string
}

export interface TaskSearchResult {
  total: number
  items: TaskDto[]
}

export interface TaskRefsResult {
  total: number
  truncated: boolean
  items: TaskRef[]
}

export interface FacetValue {
  value: string
  count: number
}

export interface Facets {
  processNames: FacetValue[]
  stepNames: FacetValue[]
  handledByNames: FacetValue[]
}

export type ParameterValue = string | number | boolean | null

export interface ActionParameter {
  name: string
  label: string
  description?: string
  type: 'boolean' | 'text' | 'textarea' | 'number' | 'select'
  required?: boolean
  default?: ParameterValue
  options?: { value: string; label: string }[]
}

export interface ActionInfo {
  key: string
  name: string
  description?: string
  color?: string
  method: string
  url: string
  body?: unknown
  auth: 'PassThrough' | 'ClientCredentials' | 'None'
  parallelism: number
  parameters: ActionParameter[]
}

export interface ExecutionResult {
  index: number
  id: string
  workflowId?: string
  success: boolean
  statusCode?: number
  error?: string
  durationMs: number
}

export type JobState = 'Running' | 'Completed' | 'Cancelled' | 'Failed'

export interface JobSnapshot {
  jobId: string
  actionKey: string
  actionName: string
  total: number
  state: JobState
  processed: number
  succeeded: number
  failed: number
  error?: string
  startedBy: string
  startedAt: string
  finishedAt?: string
  results: ExecutionResult[]
}

export interface JobProgress {
  jobId: string
  state: JobState
  processed: number
  succeeded: number
  failed: number
  total: number
  result?: ExecutionResult
  error?: string
}
