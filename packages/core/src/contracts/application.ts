export interface NoteFlowUser {
  userId: string
  userName: string
  nickName?: string
  avatar?: string
  roles?: string[]
  permissions?: string[]
}

export interface ApiEnvelope<T = unknown> {
  code?: number
  msg?: string
  data?: T
  [key: string]: unknown
}

export class NoteFlowApiError extends Error {
  code?: string
  status?: number
  details?: unknown

  constructor(message: string, options: { code?: string; status?: number; details?: unknown } = {}) {
    super(message)
    this.name = 'NoteFlowApiError'
    this.code = options.code
    this.status = options.status
    this.details = options.details
  }
}

