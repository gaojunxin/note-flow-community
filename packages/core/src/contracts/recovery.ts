/** Reading an archive never authorizes replaying its pending operations. */
export interface RecoveryArchiveBaseV1 {
  schema: 'jiyu-sync-recovery'
  version: 1
  id: string
  createdAt: string
  [futureField: string]: unknown
}
export interface PcEpochRecoveryArchiveV1 extends RecoveryArchiveBaseV1 {
  fromEpoch: string | null
  toEpoch: string
  tables: Record<string, unknown[]>
  reason?: never
}
export interface MobileEpochRecoveryArchiveV1 extends RecoveryArchiveBaseV1 {
  fromEpoch: string | null
  toEpoch: string
  stores: Record<string, unknown[]>
  reason?: never
}
/** Includes failed-operation discard, conflict decisions and legacy migration archives. */
export interface ActionRecoveryArchiveV1 extends RecoveryArchiveBaseV1 {
  reason: string
  entityUid?: string
  source?: string
  tables?: Record<string, unknown[]>
  stores?: Record<string, unknown[]>
  conflict?: Record<string, unknown>
  operations?: unknown[]
  local?: unknown
}
export type SyncRecoveryArchiveV1 = PcEpochRecoveryArchiveV1 | MobileEpochRecoveryArchiveV1 | ActionRecoveryArchiveV1
/** serialized retains exact source text, including numeric literals beyond JS precision. */
export type DecodedRecoveryArchive = {serialized:string} & (
  | {kind:'pc-epoch'; archive:PcEpochRecoveryArchiveV1}
  | {kind:'mobile-epoch'; archive:MobileEpochRecoveryArchiveV1}
  | {kind:'action'; archive:ActionRecoveryArchiveV1}

)
