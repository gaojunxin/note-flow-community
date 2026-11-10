import type {CoreContext, LocalChange, LocalEntityRef, LocalRevision, LocalWriteTransaction} from '../contracts/provider'
import {CoreProviderError} from './compatibility'
export type StagedRow = {key: string; profileId: string; revision: string; deleted: boolean; value: Record<string, unknown>}
type Row = StagedRow
export interface StagedCommit {
  original: ReadonlyMap<string, Row | undefined>
  observed: ReadonlySet<string>
  staged: ReadonlyMap<string, Row | undefined>
  mutations: ReadonlyMap<string, {ref: LocalEntityRef; before?: string; after: string; action: LocalChange['action']}>
  changes: ReadonlyMap<string, LocalChange>
}
const keyFor = (profileId: string, ref: LocalEntityRef) => JSON.stringify([profileId, ref.entityType, ref.entityUid])
const copy = <T>(value: T): T => structuredClone(value)
const fail = (code: ConstructorParameters<typeof CoreProviderError>[0], message: string): never => {throw new CoreProviderError(code, message)}
/** 回调先在内存工作集产生写集；commit适配器负责重验实际读集并原子提交，暂存不等于已持久化。 */
export async function executeStagedTransaction<T>(context: CoreContext,
  read: (key: string) => Promise<Row | undefined>, commit: (plan: StagedCommit) => Promise<void>,
  action: (tx: LocalWriteTransaction) => Promise<T>): Promise<T> {
  const original = new Map<string, Row | undefined>()
  const staged = new Map<string, Row | undefined>()
  const loading = new Map<string, Promise<void>>()
  const observed = new Set<string>()
  const mutations = new Map<string, {ref: LocalEntityRef; before?: string; after: string; action: LocalChange['action']}>()
  const changes = new Map<string, LocalChange>()
  let active = true
  const assertActive = () => {if (!active) fail('TRANSACTION_CLOSED', '事务句柄已失效')}
  const identify = (ref: LocalEntityRef) => {
    assertActive()
    if (!ref || !ref.entityType?.trim() || !ref.entityUid?.trim()) fail('INVALID_CHANGE', '实体标识无效')
    const key = keyFor(context.profileId, ref)
    observed.add(key)
    return key
  }
  const load = async (key: string) => {
    if (!loading.has(key)) loading.set(key, (async () => {
      const row = await read(key)
      assertActive()
      original.set(key, row)
      staged.set(key, row)
    })())
    await loading.get(key)
    assertActive()
    return staged.get(key)
  }
  const mutate = async (ref: LocalEntityRef, value: Record<string, unknown>, expected: string | null, deleted: boolean): Promise<LocalRevision> => {
    const key = identify(ref), before = await load(key)
    if (mutations.has(key)) fail('INVALID_CHANGE', '每个事务同一实体只能写入一次')
    if ((before?.revision ?? null) !== expected) fail('REVISION_CONFLICT', '本地实体已变化')
    if (deleted && (!before || before.deleted)) fail('REVISION_CONFLICT', '实体不存在或已删除')
    const revision = crypto.randomUUID()
    staged.set(key, {key, profileId: context.profileId, revision, deleted, value: copy({...before?.value, ...value})})
    mutations.set(key, {ref: {...ref}, before: before?.revision, after: revision, action: deleted ? 'delete' : !before || before.deleted ? 'create' : 'update'})
    return {...ref, revision}
  }
  const handle: LocalWriteTransaction = {
    async get(ref, options) {const row = await load(identify(ref)); return !row || (row.deleted && !options?.includeDeleted) ? undefined : {revision: row.revision, deleted: row.deleted, value: copy(row.value)}},
    async put(ref, value, expected) {return mutate(ref, value, expected, false)},
    async delete(ref, expected) {return mutate(ref, (await load(identify(ref)))?.value ?? {}, expected, true)},
    async appendChange(change) {
      assertActive()
      const mutation = mutations.get(identify(change))
      if (change.profileId !== context.profileId || !change.changeId?.trim() || !Number.isFinite(Date.parse(change.createdAt))
        || !mutation || mutation.before !== change.beforeRevision || mutation.after !== change.afterRevision || mutation.action !== change.action
        || changes.has(change.changeId) || [...changes.values()].some(item => keyFor(context.profileId, item) === keyFor(context.profileId, change))) {
        fail('INVALID_CHANGE', '变更日志与实体写入不匹配')
      }
      changes.set(change.changeId, copy({...change, entity: staged.get(keyFor(context.profileId, change))!.value}))
    },
  }
  let result: T
  try {
    result = await action(handle)
    if (changes.size !== mutations.size) fail('INVALID_CHANGE', '实体写入必须附带变更日志')
  } finally {active = false}
  // 回调结束后句柄已经失效；只有宿主提交成功才返回结果，失败时不能把暂存值报告成落库成功。
  await commit({original, observed, staged, mutations, changes})
  return result
}
