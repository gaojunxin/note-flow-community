import type {CoreContext, LocalReadHost, LocalTransactionHost, LocalWriteTransaction} from '../contracts/provider'
import {createLocalEntityRepository} from './entityRepository'
import {basicOccurrenceUid, nextBasicOccurrence} from './basicRecurrence'
import type {BasicRecurringTask} from './basicRecurrence'
import {CoreProviderError} from './compatibility'

export function createCommunityTasks(host: LocalTransactionHost & LocalReadHost, input: CoreContext) {
  const context = {...input}
  const tasks = createLocalEntityRepository<BasicRecurringTask>(host, context, 'task', async task => {
    if (task.recurrencePreview) throw new CoreProviderError('INVALID_CHANGE', '日历预览不能保存为真实任务')
  })
  const ref = (uid: string) => ({entityType: 'task', entityUid: uid})
  const record = async (tx: LocalWriteTransaction, value: BasicRecurringTask, expected: string | null) => {
    const after = await tx.put(ref(value.uid), value, expected)
    await tx.appendChange({...ref(value.uid), profileId: context.profileId, changeId: crypto.randomUUID(), action: expected ? 'update' : 'create', beforeRevision: expected ?? undefined, afterRevision: after.revision, createdAt: new Date().toISOString()})
    return {entity: value, revision: after.revision}
  }
  return {
    ...tasks,
    async convertToOrdinary(uid: string, revision: string) {
      return host.transaction(context, async tx => {
        const before = await tx.get(ref(uid))
        if (!before || before.revision !== revision) throw new CoreProviderError('REVISION_CONFLICT', '任务已变化')
        const task = before.value as BasicRecurringTask
        if (!task.recurrenceRule && !task.recurrenceSourceUid) throw new CoreProviderError('INVALID_CHANGE', '该任务不是重复任务')
        const backup = {recurrenceRule: task.recurrenceRule, recurrenceSourceUid: task.recurrenceSourceUid,
          recurrenceOccurrenceKey: task.recurrenceOccurrenceKey, recurrenceOrdinal: task.recurrenceOrdinal}
        return record(tx, {...task, recurrenceOriginalBackups: [...(Array.isArray(task.recurrenceOriginalBackups) ? task.recurrenceOriginalBackups : []), backup],
          recurrenceRule: null, recurrenceSourceUid: null, recurrenceOccurrenceKey: null, recurrenceOrdinal: undefined, updatedAt: new Date().toISOString()}, revision)
      })
    },
    async resolve(uid: string, revision: string, decision: 'complete' | 'skip') {
      const candidates: BasicRecurringTask[] = []
      let afterKey: string | undefined
      do {
        const page = await tasks.list({afterKey, limit: 200})
        candidates.push(...page.items.map(row => row.entity))
        afterKey = page.hasMore ? page.nextKey : undefined
      } while (afterKey)
      return host.transaction(context, async tx => {
        const before = await tx.get(ref(uid))
        if (!before || before.revision !== revision) throw new CoreProviderError('REVISION_CONFLICT', '任务已变化')
        const task = before.value as BasicRecurringTask
        if (task.completed || task.abandonedAt) throw new CoreProviderError('INVALID_CHANGE', '该期次已经处理')
        const sourceUid = task.recurrenceSourceUid || task.uid
        if (task.recurrenceRule || task.recurrenceSourceUid) {
          const key = (value: BasicRecurringTask) => value.recurrenceOccurrenceKey || value.startAt || value.dueAt || '9999'
          for (const candidate of candidates) {
            if ((candidate.recurrenceSourceUid || candidate.uid) !== sourceUid || candidate.uid === uid) continue
            const earlier = (await tx.get(ref(candidate.uid)))?.value as BasicRecurringTask | undefined
            if (earlier && !earlier.completed && !earlier.abandonedAt && (key(earlier) < key(task) || (key(earlier) === key(task) && earlier.uid < uid))) {
              throw new CoreProviderError('INVALID_CHANGE', '请先完成或跳过之前的重复周期')
            }
          }
        }
        const source = sourceUid === task.uid ? task : (await tx.get(ref(sourceUid)))?.value as BasicRecurringTask | undefined
        if (!source) throw new CoreProviderError('RECOVERY_REQUIRED', '重复系列源任务不存在')
        const next = nextBasicOccurrence(task, source)
        const now = new Date().toISOString()
        let created: {entity: BasicRecurringTask; revision: string} | undefined
        if (next) {
          const nextUid = await basicOccurrenceUid(sourceUid, next.occurrenceKey)
          const existing = await tx.get(ref(nextUid), {includeDeleted: true})
          if (existing) throw new CoreProviderError('RECOVERY_REQUIRED', '下一期已存在，需核实系列后再推进')
          created = await record(tx, {...task, ...next, uid: nextUid, recurrenceOccurrenceKey: next.occurrenceKey, recurrenceOrdinal: next.ordinal,
            recurrenceSourceUid: sourceUid, completed: false, completedAt: null, abandonedAt: null, createdAt: now, updatedAt: now}, null)
        }
        const resolved = await record(tx, {...task, completed: decision === 'complete', completedAt: decision === 'complete' ? now : null,
          abandonedAt: decision === 'skip' ? now : null, updatedAt: now}, revision)
        return {resolved, next: created}
      })
    },
  }
}
