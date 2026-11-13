import {stagedLearningExecutionRepository} from '../services/learningExecutionRepository'
import {validateExecutionBackup,type ExecutionBackup} from '../services/learningExecutionValidation'
import {stagedLearningActionRepository} from '../services/learningActionRepository'
import {stagedLearningRepository} from '../services/learningRepository'
import {openStagedLearningCache} from '../services/learningCacheStorage'
import {LOCAL_LEARNING_EPOCH} from '../services/localLearningEpoch'
import {validateLearningCache, type LearningSession, type LearningCache} from '@note-flow/core/ai-learning'
import {validateLearningActions} from '../services/learningActionArchive'

export function communityLearningScope(profileId: string) {
  const owner = `community-${profileId}`
  const generation = localStorage.getItem(`note-flow-ai-data-generation:${owner}`)
  return owner + (generation ? `:reset:${generation}` : '')
}
export interface CommunityLearningBackup {
  schema: 'note-flow-community-learning'; version: 1; scope: string
  sessions: LearningSession[]; operations: unknown[]
  actions: ReturnType<typeof validateLearningActions>
  cache?: LearningCache; recoveryCache?: LearningCache;execution?:ExecutionBackup
}
export function validateCommunityLearningBackup(value: unknown, profileId: string): CommunityLearningBackup {
  const v = value as CommunityLearningBackup
  const owner = `community-${profileId}`
  if (!v || v.schema !== 'note-flow-community-learning' || v.version !== 1 ||
    typeof v.scope !== 'string' || !(v.scope === owner || v.scope.startsWith(`${owner}:reset:`) && v.scope.length > owner.length + 7) ||
    !Array.isArray(v.operations)) throw Error('学习备份空间或格式无效')
  validateLearningCache({sessions: v.sessions, selectedUid: '', input: '', draft: '', sources: []})
  validateLearningActions(v.actions, v.scope)
  if(v.execution!==undefined)validateExecutionBackup(v.execution,v.scope)
  if (v.cache !== undefined) validateLearningCache(v.cache)
  if (v.recoveryCache !== undefined) validateLearningCache(v.recoveryCache)
  return v
}
export async function captureCommunityLearning(profileId: string): Promise<CommunityLearningBackup> {
  const scope = communityLearningScope(profileId)
  const mirror = await openStagedLearningCache(profileId,scope)
  const cache = mirror.value ?? undefined, recoveryCache = mirror.recovery ?? undefined
  const repository=await stagedLearningRepository(profileId,scope),{sessions,operations}=await repository.snapshot()
  const actionRepository=await stagedLearningActionRepository(profileId,scope),actions=await actionRepository.snapshot()
  const execution=await(await stagedLearningExecutionRepository(profileId,scope)).backup()
  repository.check();actionRepository.check();if(scope!==communityLearningScope(profileId))throw Error('学习空间已变化，请重新备份')
  return validateCommunityLearningBackup({schema:'note-flow-community-learning',version:1,scope,sessions,operations,actions,cache,recoveryCache,execution},profileId)
}

function interruptPending(session: LearningSession) {
  for (const message of session.messages) if (message.status === 'pending') {
    message.status = 'interrupted'; message.finishReason = 'process_exit'
  }
  return session
}
function prepareLearningRestore(value: CommunityLearningBackup) {
  const sessions = new Map(value.sessions.map(original => [original.uid, interruptPending(structuredClone(original))]))
  const cache = value.cache === undefined ? undefined : structuredClone(value.cache)
  if (cache) {
    delete cache.pendingSend; delete cache.operation
    const selected = cache.selectedUid
    for (const original of cache.sessions) {
      const draft = interruptPending(structuredClone(original)), existing = sessions.get(draft.uid)
      if (draft.uid === selected) {draft.input = cache.input; draft.draft = cache.draft}
      const compatible = existing && existing.revision === draft.revision && existing.title === draft.title && JSON.stringify(existing.messages) === JSON.stringify(draft.messages)
      if (compatible) {
        sessions.set(draft.uid, {...existing, input:draft.input, draft:draft.draft, draftSources:draft.draftSources})
      } else {
        const originalUid = draft.uid
        draft.uid = crypto.randomUUID(); draft.revision = 1
        draft.title = (draft.title || '讨论').slice(0, 192) + '（恢复草稿）'
        sessions.set(draft.uid, draft)
        if (selected === originalUid) cache.selectedUid = draft.uid
      }
    }
    cache.sessions = [...sessions.values()]
    validateLearningCache(cache)
  }
  return {sessions:[...sessions.values()], cache}
}

/** 新空间发布前暂存可阅读讨论和草稿；执行日志只保留在恢复档案，不能进入待执行队列。 */
export async function stageCommunityLearning(value: CommunityLearningBackup, targetProfileId: string) {
  const prepared = prepareLearningRestore(value)
  const scope=`community-${targetProfileId}`,repository=await stagedLearningRepository(targetProfileId,scope)
  await repository.restore(prepared.sessions,true)
  const actionRepository=await stagedLearningActionRepository(targetProfileId,scope)
  // 原执行日志保留惰性恢复档案；新空间仅恢复可编辑草稿，不继承旧租约或执行资格。
  await actionRepository.restore({drafts:value.actions.drafts.map(draft=>({...structuredClone(draft),scope})),operations:[]},true)
  if(value.execution)await(await stagedLearningExecutionRepository(targetProfileId,scope)).archive(value.execution)
  const mirror = await openStagedLearningCache(targetProfileId)
  if(mirror.value!==null||mirror.recovery!==null)throw Error('学习草稿恢复目标不是空空间')
  const safeCache=(original:LearningCache|undefined)=>{
    if(original===undefined)return null
    const cache=structuredClone(original)
    delete cache.pendingSend;delete cache.operation;cache.epoch=LOCAL_LEARNING_EPOCH
    for(const session of cache.sessions)interruptPending(session)
    return validateLearningCache(cache)
  }
  await mirror.restoreMissing(safeCache(prepared.cache),safeCache(value.recoveryCache))
}
