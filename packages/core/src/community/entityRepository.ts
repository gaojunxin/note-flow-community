import type {CoreContext, LocalChange, LocalReadHost, LocalTransactionHost, LocalWriteTransaction} from '../contracts/provider'
import {CoreProviderError, validateCoreContext} from './compatibility'

export interface LocalEntity extends Record<string, unknown> {
  uid: string
  createdAt?: string
  updatedAt?: string
}
export interface LocalRecord<T extends LocalEntity> {revision: string; deleted: boolean; entity: T}

/** Pure local CRUD. No account, transport, queue scheduler or server-version dependency. */
export function createLocalEntityRepository<T extends LocalEntity>(
  host: LocalTransactionHost & LocalReadHost,
  input: CoreContext,
  entityType: string,
  validate?: (entity: T, tx: LocalWriteTransaction) => Promise<void>,
) {
  validateCoreContext(input)
  if (!entityType.trim()) throw new CoreProviderError('INVALID_CHANGE', '实体类型无效')
  const context = {...input}
  const ref = (uid: string) => ({entityType, entityUid: uid})
  const write = async (entity: T, expectedRevision: string | null, action: LocalChange['action']) => {
    const draft = structuredClone(entity)
    return host.transaction(context, async tx => {
      const before = await tx.get(ref(draft.uid), {includeDeleted: true})
      const now = new Date().toISOString()
      const value = {...before?.value, ...draft, createdAt: before?.value.createdAt ?? draft.createdAt ?? now, updatedAt: now} as T
      if (action !== 'delete') await validate?.(value, tx)
      const after = action === 'delete'
        ? await tx.delete(ref(value.uid), expectedRevision!)
        : await tx.put(ref(value.uid), value, expectedRevision)
      await tx.appendChange({...ref(value.uid), profileId: context.profileId, changeId: crypto.randomUUID(), action,
        beforeRevision: expectedRevision ?? undefined, afterRevision: after.revision, createdAt: now})
      return {revision: after.revision, deleted: action === 'delete', entity: value}
    })
  }
  return {
    async get(uid: string, includeDeleted = false): Promise<LocalRecord<T> | undefined> {
      return host.transaction(context, async tx => {
        const row = await tx.get(ref(uid), {includeDeleted})
        return row ? {revision: row.revision, deleted: Boolean(row.deleted), entity: row.value as T} : undefined
      })
    },
    async list(request: {afterKey?: string; limit?: number; includeDeleted?: boolean} = {}) {
      const page = await host.listEntities(context, {...request, entityType})
      return {...page, items: page.items.map(row => ({revision: row.revision, deleted: row.deleted, entity: row.value as T}))}
    },
    create(entity: Omit<T, 'uid'> & {uid?: string}) {
      return write({...entity, uid: entity.uid ?? crypto.randomUUID()} as T, null, 'create')
    },
    update(entity: T, expectedRevision: string) {return write(entity, expectedRevision, 'update')},
    remove(entity: T, expectedRevision: string) {return write(entity, expectedRevision, 'delete')},
    async restore(uid: string, expectedRevision: string) {
      const row = await this.get(uid, true)
      if (!row?.deleted || row.revision !== expectedRevision) throw new CoreProviderError('REVISION_CONFLICT', '待恢复记录已变化')
      return write(row.entity, expectedRevision, 'create')
    },
  }
}
