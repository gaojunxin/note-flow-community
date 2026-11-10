import type {CoreContext, LocalTransactionHost, LocalReadHost, LocalBackupHost, LocalWriteTransaction, LocalEntityRef, LocalChange, LocalWorkspaceSnapshot} from '../contracts/provider'
import {CoreProviderError, validateCoreContext} from './compatibility'
import {decodePortableValue, encodePortableValue} from './portableValue'
import {executeStagedTransaction} from './stagedTransaction'

/** The platform owns the database path. Neither SQL nor paths cross this interface. */
export interface NativeLocalTransport {
  request(input: {profileId: string; operation: 'get'|'commit'|'listEntities'|'listChanges'|'export'|'restore'; args: unknown}): Promise<unknown>
}
const invalid = (): never => {throw new CoreProviderError('STORAGE_ERROR', '原生本地仓储响应无效')}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
const refFromKey = (profileId: string, key: string): LocalEntityRef => {
  let parts: unknown
  try {parts = JSON.parse(key)} catch {return invalid()}
  if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== profileId || typeof parts[1] !== 'string' || typeof parts[2] !== 'string') return invalid()
  return {entityType: parts[1], entityUid: parts[2]}
}
const keyFor = (profileId: string, reference: LocalEntityRef) => JSON.stringify([profileId, reference.entityType, reference.entityUid])
const decodeEntity = (input: unknown) => {
  const row = object(input)
  if (typeof row.entityType !== 'string' || !row.entityType.trim() || typeof row.entityUid !== 'string' || !row.entityUid.trim()
    || typeof row.revision !== 'string' || !row.revision.trim() || typeof row.deleted !== 'boolean') return invalid()
  return {entityType: row.entityType, entityUid: row.entityUid, revision: row.revision, deleted: row.deleted, value: object(decodePortableValue(row.value))}
}
const decodeChange = (input: unknown, profileId: string): LocalChange & {sequence: number} => {
  const change = object(input)
  if (change.profileId !== profileId || typeof change.changeId !== 'string' || !change.changeId.trim()
    || typeof change.entityType !== 'string' || typeof change.entityUid !== 'string'
    || !['create','update','delete'].includes(String(change.action)) || typeof change.afterRevision !== 'string'
    || typeof change.createdAt !== 'string' || !Number.isFinite(Date.parse(change.createdAt))
    || !Number.isSafeInteger(change.sequence) || Number(change.sequence) < 1) return invalid()
  return {...change, ...(change.entity === undefined ? {} : {entity: object(decodePortableValue(change.entity))})} as LocalChange & {sequence: number}
}

export function createNativeLocalHost(transport: NativeLocalTransport): LocalTransactionHost & LocalReadHost & LocalBackupHost & {close(): Promise<void>} {
  let closed = false
  const contextFor = (input: CoreContext) => {
    validateCoreContext(input)
    if (input.storageSchemaVersion !== 1) throw new CoreProviderError('SCHEMA_INCOMPATIBLE', '原生本地宿主仅支持逻辑 schema 1')
    if (closed) throw new CoreProviderError('DISPOSED', '本地宿主已关闭')
    return {...input}
  }
  const request = (context: CoreContext, operation: Parameters<NativeLocalTransport['request']>[0]['operation'], args: unknown) => {
    contextFor(context)
    return transport.request({profileId: context.profileId, operation, args})
  }
  const limitFor = (limit = 50) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new CoreProviderError('INVALID_CONTEXT', '分页大小必须为 1～200')
    return limit
  }
  return {
    async close() {closed = true},
    async transaction<T>(input: CoreContext, action: (tx: LocalWriteTransaction) => Promise<T>): Promise<T> {
      const context = contextFor(input)
      return executeStagedTransaction(context, async key => {
        const reference = refFromKey(context.profileId, key)
        const result = await request(context, 'get', reference)
        if (result === null) return undefined
        const entity = decodeEntity(result)
        if (entity.entityType !== reference.entityType || entity.entityUid !== reference.entityUid) return invalid()
        return {key, profileId: context.profileId, ...entity}
      }, async ({original, observed, staged, mutations, changes}) => {
        const encoded = []
        for (const [key, mutation] of mutations) {
          const row = staged.get(key)!
          const change = [...changes.values()].find(change => keyFor(context.profileId, change) === key)!
          const value = await encodePortableValue(row.value)
          encoded.push({entity: {...mutation.ref, revision: row.revision, deleted: row.deleted, value}, expectedRevision: mutation.before ?? null, change: {...change, entity: value}})
        }
        await request(context, 'commit', {observations: [...observed].map(key => ({...refFromKey(context.profileId, key), revision: original.get(key)?.revision ?? null})), mutations: encoded})
      }, action)
    },
    async listEntities(input, query = {}) {
      const context = contextFor(input), limit = limitFor(query.limit)
      const result = object(await request(context, 'listEntities', {entityType: query.entityType, after: query.afterKey ? refFromKey(context.profileId, query.afterKey) : undefined, includeDeleted: Boolean(query.includeDeleted), limit}))
      if (!Array.isArray(result.items) || typeof result.hasMore !== 'boolean' || result.items.length > limit) return invalid()
      const items = result.items.map(row => {const entity = decodeEntity(row); return {...entity, key: keyFor(context.profileId, entity)}})
      return {items, hasMore: result.hasMore, nextKey: result.hasMore ? items.at(-1)?.key : undefined}
    },
    async listChanges(input, query = {}) {
      const context = contextFor(input), after = query.afterSequence ?? 0, limit = limitFor(query.limit)
      if (!Number.isSafeInteger(after) || after < 0) throw new CoreProviderError('INVALID_CONTEXT', '日志游标无效')
      const result = object(await request(context, 'listChanges', {after, limit}))
      if (!Array.isArray(result.items) || typeof result.hasMore !== 'boolean' || !Number.isSafeInteger(result.nextSequence) || result.items.length > limit) return invalid()
      const items = result.items.map(row => decodeChange(row, context.profileId))
      let previous = after
      for (const item of items) {if (item.sequence <= previous) return invalid(); previous = item.sequence}
      if (result.nextSequence !== previous) return invalid()
      return {items, hasMore: result.hasMore, nextSequence: previous}
    },
    async exportWorkspace(input) {
      const context = contextFor(input)
      const raw = object(await request(context, 'export', {exportedAt: new Date().toISOString()}))
      if (raw.schema !== 'note-flow-community-workspace' || raw.version !== 1 || raw.profileId !== context.profileId
        || typeof raw.exportedAt !== 'string' || !Number.isFinite(Date.parse(raw.exportedAt)) || !Array.isArray(raw.entities) || !Array.isArray(raw.changes)) return invalid()
      return {schema: 'note-flow-community-workspace', version: 1, exportedAt: raw.exportedAt, profileId: context.profileId,
        entities: raw.entities.map(decodeEntity), changes: raw.changes.map(row => decodeChange(row, context.profileId))}
    },
    async restoreWorkspace(input, snapshot: LocalWorkspaceSnapshot) {
      const context = contextFor(input), backup = structuredClone(snapshot)
      if (backup?.schema !== 'note-flow-community-workspace' || backup.version !== 1 || !Array.isArray(backup.entities) || !Array.isArray(backup.changes)) throw new CoreProviderError('INVALID_CHANGE', '备份格式无效')
      const entities = await Promise.all(backup.entities.map(async row => ({...row, value: await encodePortableValue(row.value)})))
      const changes = await Promise.all(backup.changes.map(async change => ({...change, ...(change.entity === undefined ? {} : {entity: await encodePortableValue(change.entity)})})))
      await request(context, 'restore', {...backup, entities, changes})
    },
  }
}
