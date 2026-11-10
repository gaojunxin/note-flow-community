import {openDB} from 'idb'
import {executeStagedTransaction} from './stagedTransaction'
import type {CoreContext, LocalChange, LocalEntityRef, LocalTransactionHost, LocalWriteTransaction, LocalReadHost, LocalBackupHost, LocalWorkspaceSnapshot} from '../contracts/provider'
import {CoreProviderError, validateCoreContext} from './compatibility'

type Row = {key: string; profileId: string; revision: string; deleted: boolean; value: Record<string, unknown>}
const keyFor = (profileId: string, ref: LocalEntityRef) => JSON.stringify([profileId, ref.entityType, ref.entityUid])
const copy = <T>(value: T): T => structuredClone(value)
const fail = (code: ConstructorParameters<typeof CoreProviderError>[0], message: string): never => {throw new CoreProviderError(code, message)}

/** Isolated community database. Does not open or migrate existing official databases. */
export function createIndexedDbLocalHost(databaseName: string): LocalTransactionHost & LocalReadHost & LocalBackupHost & {close(): Promise<void>} {
  if (!databaseName.trim()) throw new Error('Database name is required')
  let closed = false
  const database = openDB(databaseName, 2, {upgrade(db, oldVersion, _newVersion, tx) {
    if (oldVersion < 1) {
      const entities = db.createObjectStore('local_entities', {keyPath: 'key'})
      entities.createIndex('by-profile', 'profileId')
      const changes = db.createObjectStore('local_changes', {keyPath: 'key'})
      changes.createIndex('by-profile', 'profileId')
    }
    if (oldVersion < 2) {
      db.createObjectStore('local_metadata')
      const changes = tx.objectStore('local_changes')
      changes.createIndex('by-profile-sequence', ['profileId', 'sequence'], {unique: true})
      // Preserve the prototype v1 log, assigning stable ordering during upgrade.
      let sequence = 0
      const migrate = async () => {
        let cursor = await changes.openCursor()
        while (cursor) {
          await cursor.update({...cursor.value, sequence: ++sequence})
          cursor = await cursor.continue()
        }
        await tx.objectStore('local_metadata').put(sequence, 'changeSequence')
      }
      void migrate().catch(() => tx.abort())
    }
  }})
  const assertContext = (input: CoreContext) => {
    validateCoreContext(input)
    if (input.storageSchemaVersion !== 1) fail('SCHEMA_INCOMPATIBLE', '本地宿主仅支持逻辑 schema 1')
    if (closed) fail('DISPOSED', '本地宿主已关闭')
  }
  const pageSize = (limit: number) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail('INVALID_CONTEXT', '分页大小必须为 1～200')
    return limit
  }
  return {
    async close() {closed = true; (await database).close()},
    async exportWorkspace(input) {
      assertContext(input)
      const context = {...input}, db = await database
      const tx = db.transaction(['local_entities', 'local_changes'])
      const [entities, changes] = await Promise.all([
        tx.objectStore('local_entities').index('by-profile').getAll(context.profileId),
        tx.objectStore('local_changes').index('by-profile-sequence').getAll(IDBKeyRange.bound([context.profileId, 0], [context.profileId, Number.MAX_SAFE_INTEGER])),
      ])
      await tx.done
      return {
        schema: 'note-flow-community-workspace', version: 1, exportedAt: new Date().toISOString(), profileId: context.profileId,
        entities: entities.map((row: Row) => ({entityType: JSON.parse(row.key)[1], entityUid: JSON.parse(row.key)[2], revision: row.revision, deleted: row.deleted, value: row.value})),
        changes: changes.map(({key: _key, ...change}) => change) as LocalWorkspaceSnapshot['changes'],
      }
    },
    async restoreWorkspace(input, snapshot) {
      assertContext(input)
      const context = {...input}, backup = copy(snapshot)
      if (backup?.schema !== 'note-flow-community-workspace' || backup.version !== 1 || !backup.profileId?.trim()
        || !Number.isFinite(Date.parse(backup.exportedAt)) || !Array.isArray(backup.entities) || !Array.isArray(backup.changes)) fail('INVALID_CHANGE', '备份格式无效')
      const entityKeys = new Set<string>(), changeIds = new Set<string>()
      for (const row of backup.entities) {
        if (!row?.entityType?.trim() || !row.entityUid?.trim() || !row.revision?.trim() || typeof row.deleted !== 'boolean'
          || !row.value || typeof row.value !== 'object' || Array.isArray(row.value)) fail('INVALID_CHANGE', '备份实体无效')
        const key = keyFor(context.profileId, row)
        if (entityKeys.has(key)) fail('INVALID_CHANGE', '备份实体重复')
        entityKeys.add(key)
      }
      let previousSequence = 0
      for (const change of backup.changes) {
        if (!change?.changeId?.trim() || change.profileId !== backup.profileId || changeIds.has(change.changeId)
          || !Number.isSafeInteger(change.sequence) || change.sequence <= previousSequence || !change.afterRevision?.trim()
          || !['create','update','delete'].includes(change.action) || !Number.isFinite(Date.parse(change.createdAt))
          || !entityKeys.has(keyFor(context.profileId, change))) fail('INVALID_CHANGE', '备份日志无效')
        previousSequence = change.sequence
        changeIds.add(change.changeId)
      }
      const db = await database
      const tx = db.transaction(['local_entities', 'local_changes', 'local_metadata'], 'readwrite')
      try {
        if (await tx.objectStore('local_entities').index('by-profile').count(context.profileId)
          || await tx.objectStore('local_changes').index('by-profile').count(context.profileId)) fail('PROFILE_BUSY', '请将备份恢复到新的空白空间')
        for (const row of backup.entities) await tx.objectStore('local_entities').add({key: keyFor(context.profileId, row), profileId: context.profileId, revision: row.revision, deleted: row.deleted, value: row.value})
        let sequence = (await tx.objectStore('local_metadata').get('changeSequence') as number | undefined) ?? 0
        for (const change of backup.changes) await tx.objectStore('local_changes').add({...change, profileId: context.profileId, sequence: ++sequence, key: JSON.stringify([context.profileId, change.changeId])})
        await tx.objectStore('local_metadata').put(sequence, 'changeSequence')
        await tx.done
      } catch (error) {
        try {tx.abort()} catch { /* already aborted */ }
        await tx.done.catch(() => {})
        throw error
      }
    },
    async listEntities(input, request = {}) {
      assertContext(input)
      const context = {...input}, limit = pageSize(request.limit ?? 50)
      const db = await database
      const tx = db.transaction('local_entities')
      let cursor = await tx.store.index('by-profile').openCursor(context.profileId)
      const items = []
      // primary key resume within the profile index; bounded returned payload.
      if (cursor && request.afterKey && String(cursor.primaryKey) < request.afterKey) {
        cursor = await cursor.continuePrimaryKey(context.profileId, request.afterKey)
      }
      while (cursor && items.length < limit + 1) {
        const row = cursor.value as Row
        if ((!request.afterKey || row.key > request.afterKey) && (!request.entityType || JSON.parse(row.key)[1] === request.entityType)
          && (request.includeDeleted || !row.deleted)) {
          items.push({key: row.key, entityType: JSON.parse(row.key)[1] as string, entityUid: JSON.parse(row.key)[2] as string, revision: row.revision, deleted: row.deleted, value: copy(row.value)})
        }
        cursor = await cursor.continue()
      }
      await tx.done
      const hasMore = items.length > limit
      const page = items.slice(0, limit)
      return {items: page, hasMore, nextKey: hasMore ? page[page.length - 1].key : undefined}
    },
    async listChanges(input, request = {}) {
      assertContext(input)
      const context = {...input}, limit = pageSize(request.limit ?? 50), after = request.afterSequence ?? 0
      if (!Number.isSafeInteger(after) || after < 0) fail('INVALID_CONTEXT', '日志游标无效')
      const db = await database
      const tx = db.transaction('local_changes')
      const range = IDBKeyRange.bound([context.profileId, after], [context.profileId, Number.MAX_SAFE_INTEGER], true)
      const rows = await tx.store.index('by-profile-sequence').getAll(range, limit + 1)
      await tx.done
      const hasMore = rows.length > limit
      const items = rows.slice(0, limit).map(row => {
        const {key: _key, ...change} = row
        return change as LocalChange & {sequence: number}
      })
      return {items, hasMore, nextSequence: items.at(-1)?.sequence ?? after}
    },
    async transaction<T>(input: CoreContext, action: (tx: LocalWriteTransaction) => Promise<T>): Promise<T> {
      assertContext(input)
      const context = {...input}
      const db = await database
      return executeStagedTransaction(context,
        async key => await db.get('local_entities', key) as Row | undefined,
        async ({original, observed, staged, mutations, changes}) => {
          if (closed) fail('DISPOSED', '本地宿主已关闭')
          // Only IDB requests occur inside this real transaction. Arbitrary async work
          // above cannot accidentally auto-commit a partial entity/log write.
          const tx = db.transaction(['local_entities', 'local_changes', 'local_metadata'], 'readwrite')
          try {
            for (const key of observed) {
              const current = await tx.objectStore('local_entities').get(key) as Row | undefined
              if (current?.revision !== original.get(key)?.revision) fail('REVISION_CONFLICT', '提交前本地实体已变化')
            }
            for (const key of mutations.keys()) await tx.objectStore('local_entities').put(staged.get(key)!)
            let sequence = (await tx.objectStore('local_metadata').get('changeSequence') as number | undefined) ?? 0
            for (const change of changes.values()) await tx.objectStore('local_changes').add({...change, sequence: ++sequence, key: JSON.stringify([context.profileId, change.changeId])})
            if (changes.size) await tx.objectStore('local_metadata').put(sequence, 'changeSequence')
            await tx.done
          } catch (error) {
            try {tx.abort()} catch { /* already aborted */ }
            await tx.done.catch(() => {})
            throw error
          }
        }, action)
    },
  }
}
