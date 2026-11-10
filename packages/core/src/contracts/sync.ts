/** Public Sync V2 wire and host contracts. No engine implementation imports. */
export const SYNC_PROTOCOL_VERSION = 2 as const

export type SyncAction = 'create' | 'update' | 'delete'
export type SyncOperationStatus = 'pending' | 'pushing' | 'retry_wait' | 'conflict' | 'permanent_failed'
export type SyncResultStatus = 'applied' | 'conflict' | 'retryable_error' | 'permanent_error'
export type SyncRuntimePhase = 'idle' | 'syncing' | 'offline' | 'conflict' | 'error'

export interface SyncOperationV2<T = Record<string, unknown>> {
  operationId: string
  entityType: string
  entityUid: string
  action: SyncAction
  baseVersion: number
  payload?: T
  baseEntity?: T
  status: SyncOperationStatus
  createdAt: string
  attempts: number
  nextRetryAt?: string
  leaseUntil?: string
  lastError?: string
}

export interface SyncPushResultV2<T = Record<string, unknown>> {
  operationId: string
  status: SyncResultStatus
  code?: string
  entityType?: string
  entityUid?: string
  version?: number
  serverVersion?: number
  entity?: T
  serverEntity?: T
  message?: string
}

export interface SyncChangeV2<T = Record<string, unknown>> {
  seq?: number
  entityType: string
  entityUid: string
  action: SyncAction
  version: number
  entity?: T
}

export interface SyncPullPageV2 {
  changes: SyncChangeV2[]
  nextCursor: string
  hasMore: boolean
}

export interface SyncBootstrapPageV2 {
  snapshotId: string
  highWatermark: string
  items: SyncChangeV2[]
  nextPageToken?: string
  hasMore: boolean
}

export interface SyncConflictV2<T = Record<string, unknown>> {
  conflictId: string
  operationId: string
  entityType: string
  entityUid: string
  baseEntity?: T
  localEntity?: T
  serverEntity?: T
  conflictingFields: string[]
  createdAt: string
}

export interface SyncStorageAdapter {
  transaction<T>(action: () => Promise<T>): Promise<T>
  getDeviceId(): Promise<string | undefined>
  setDeviceId(value: string): Promise<void>
  getCursor(): Promise<string | undefined>
  setCursor(value: string): Promise<void>
  listOperations(statuses: SyncOperationStatus[], now: string, limit: number): Promise<SyncOperationV2[]>
  putOperation(operation: SyncOperationV2): Promise<void>
  deleteOperation(operationId: string): Promise<void>
  getEntity(entityType: string, entityUid: string): Promise<Record<string, unknown> | undefined>
  putEntity(entityType: string, entity: Record<string, unknown>): Promise<void>
  putBaseline(entityType: string, entityUid: string, entity: Record<string, unknown>): Promise<void>
  putConflict(conflict: SyncConflictV2): Promise<void>
  countConflicts(): Promise<number>
  resetServerMirror(): Promise<void>
  beginBootstrap?(snapshotId: string): Promise<void>
  commitBootstrap?(snapshotId: string, cursor: string): Promise<void>
  abortBootstrap?(snapshotId: string): Promise<void>
}

export interface SyncTransportV2 {
  push(request: { protocolVersion: 2; deviceId: string; clientVersion: string; operations: SyncOperationV2[] }): Promise<{ results: SyncPushResultV2[] }>
  pull(cursor: string | undefined, limit: number): Promise<SyncPullPageV2>
  acknowledge(deviceId: string, cursor: string, clientVersion: string): Promise<void>
  bootstrap?(pageToken: string | undefined, limit: number): Promise<SyncBootstrapPageV2>
}

export interface SyncEntityDefinition {
  type: string
  store: string
  dependencies?: (operation: SyncOperationV2) => Array<{ entityType: string; entityUid: string }>
  serverOwnedFields?: string[]
  applyRemote?: (change: SyncChangeV2, storage: SyncStorageAdapter) => Promise<void>
}

