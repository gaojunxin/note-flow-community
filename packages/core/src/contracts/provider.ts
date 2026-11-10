/** Component API version is independent of the Sync V2 wire protocol. */
export const CORE_CONTRACT_VERSION = 1 as const

export type CoreCapability = 'sync' | 'crossDeviceRecovery' | 'advancedRecurrence' | 'automation'
export interface CoreCapabilities {
  contractVersion: number
  componentVersion: string
  storageSchemaRange: { min: number; max: number }
  features: Readonly<Record<CoreCapability, boolean>>
}
export type CoreErrorCode =
  | 'CAPABILITY_UNAVAILABLE' | 'CONTRACT_INCOMPATIBLE' | 'SCHEMA_INCOMPATIBLE'
  | 'INVALID_CONTEXT' | 'NOT_INITIALIZED' | 'DISPOSED' | 'INVALID_CAPABILITIES'
  | 'REVISION_CONFLICT' | 'INVALID_CHANGE' | 'TRANSACTION_CLOSED'
  | 'PROFILE_BUSY' | 'CANCELLED' | 'RECOVERY_REQUIRED' | 'STORAGE_ERROR'
  | 'AUTH_REQUIRED' | 'CONTEXT_CHANGED'

export interface CoreContext {
  /** Stable local identity; independent of login and remote account identity. */
  profileId: string
  storageSchemaVersion: number
}

export interface LocalEntityRef { entityType: string; entityUid: string }
export interface LocalRevision extends LocalEntityRef { revision: string }
export interface LocalChange extends LocalEntityRef {
  changeId: string
  profileId: string
  action: 'create' | 'update' | 'delete'
  beforeRevision?: string
  afterRevision: string
  createdAt: string
  /** Durable content/blob reference, never an expiring remote URL. */
  contentRef?: string
  /** Immutable entity snapshot for local recovery/reconciliation. */
  entity?: Record<string, unknown>
}

/**
 * A transaction-scoped handle. It must never escape the callback.
 * Entity writes and appendChange commit or roll back together.
 * Implementations enforce profile isolation and retain unknown entity fields.
 */
export interface LocalWriteTransaction {
  get(ref: LocalEntityRef, options?: {includeDeleted?: boolean}): Promise<{ revision: string; deleted?: boolean; value: Record<string, unknown> } | undefined>
  put(ref: LocalEntityRef, value: Record<string, unknown>, expectedRevision: string | null): Promise<LocalRevision>
  delete(ref: LocalEntityRef, expectedRevision: string): Promise<LocalRevision>
  appendChange(change: LocalChange): Promise<void>
}
export interface LocalTransactionHost {
  transaction<T>(context: CoreContext, action: (tx: LocalWriteTransaction) => Promise<T>): Promise<T>
}

export interface CoreStatus {
  phase: 'local' | 'idle' | 'syncing' | 'offline' | 'conflict' | 'error'
  stage?: string
  processed?: number
  total?: number
  error?: { code: CoreErrorCode; message: string }
}
export type ConflictDecision = 'keepLocal' | 'useRemote' | 'keepBoth'
export interface CoreConflict extends LocalEntityRef {
  conflictId: string
  /** Revision of the presented conflict; reject decisions on changed conflicts. */
  revision: string
  allowedDecisions: readonly ConflictDecision[]
}
export interface RecoveryPlan {
  planId: string
  profileId: string
  /** Guard against edits between preparation and explicit application. */
  localRevision: string
  summary: { affected: number; archived: number }
}

/**
 * One instance per profile. initialize is idempotent for the same context;
 * switching profile/schema requires disposing and creating another instance.
 * subscribeStatus immediately delivers the current snapshot; unsubscribe is idempotent.
 * dispose is idempotent and releases subscriptions; later operations reject DISPOSED.
 * cancelSync is safe when idle. listConflicts may return [] without sync support.
 * Unsupported writes reject CAPABILITY_UNAVAILABLE, never simulate success.
 * Local CRUD/backup/export use LocalTransactionHost, independent of this provider.
 */
export interface CoreProvider {
  initialize(context: CoreContext): Promise<CoreCapabilities>
  startSync(): Promise<void>
  cancelSync(): Promise<void>
  subscribeStatus(listener: (status: CoreStatus) => void): () => void
  listConflicts(): Promise<readonly CoreConflict[]>
  resolveConflict(conflictId: string, revision: string, decision: ConflictDecision): Promise<void>
  prepareRecovery(): Promise<RecoveryPlan>
  applyRecovery(plan: RecoveryPlan): Promise<void>
  dispose(): Promise<void>
}

/** Pagination is scoped to a local profile; cursors are not remote sync cursors. */
export interface LocalReadHost {
  listEntities(context: CoreContext, request?: {entityType?: string; afterKey?: string; limit?: number; includeDeleted?: boolean}): Promise<{
    items: Array<LocalEntityRef & {key: string; revision: string; deleted: boolean; value: Record<string, unknown>}>
    hasMore: boolean
    nextKey?: string
  }>
  listChanges(context: CoreContext, request?: {afterSequence?: number; limit?: number}): Promise<{
    items: Array<LocalChange & {sequence: number}>
    hasMore: boolean
    nextSequence: number
  }>
}

export interface LocalWorkspaceSnapshot {
  schema: 'note-flow-community-workspace'
  version: 1
  exportedAt: string
  profileId: string
  entities: Array<LocalEntityRef & {revision: string; deleted: boolean; value: Record<string, unknown>}>
  changes: Array<LocalChange & {sequence: number}>
}
export interface LocalBackupHost {
  exportWorkspace(context: CoreContext): Promise<LocalWorkspaceSnapshot>
  /** Restore into an empty profile only; never overwrite an existing workspace. */
  restoreWorkspace(context: CoreContext, snapshot: LocalWorkspaceSnapshot): Promise<void>
}
