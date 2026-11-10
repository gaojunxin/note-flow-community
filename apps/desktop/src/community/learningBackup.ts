import {LOCAL_LEARNING_EPOCH} from '../services/localLearningEpoch'
import {openDB} from 'idb'
import {validateLearningCache, type LearningSession, type LearningCache} from '@note-flow/core/ai-learning'
import {validateLearningActions} from '../services/learningActionArchive'

const learningDb = (scope: string) => openDB(`note-flow-local-learning:${scope}`, 1, {upgrade(db) {
  db.createObjectStore('sessions', {keyPath: 'uid'})
  db.createObjectStore('operations', {keyPath: 'uid'})
}})
const actionsDb = (scope: string) => openDB(`note-flow-ai-actions:${scope}`, 1, {upgrade(db) {
  db.createObjectStore('drafts', {keyPath: 'uid'})
  db.createObjectStore('operations', {keyPath: 'uid'})
}})
export function communityLearningScope(profileId: string) {
  const owner = `community-${profileId}`
  const generation = localStorage.getItem(`note-flow-ai-data-generation:${owner}`)
  return owner + (generation ? `:reset:${generation}` : '')
}
export interface CommunityLearningBackup {
  schema: 'note-flow-community-learning'; version: 1; scope: string
  sessions: LearningSession[]; operations: unknown[]
  actions: ReturnType<typeof validateLearningActions>
  cache?: LearningCache; recoveryCache?: LearningCache
}
export function validateCommunityLearningBackup(value: unknown, profileId: string): CommunityLearningBackup {
  const v = value as CommunityLearningBackup
  const owner = `community-${profileId}`
  if (!v || v.schema !== 'note-flow-community-learning' || v.version !== 1 ||
    typeof v.scope !== 'string' || !(v.scope === owner || v.scope.startsWith(`${owner}:reset:`) && v.scope.length > owner.length + 7) ||
    !Array.isArray(v.operations)) throw Error('学习备份空间或格式无效')
  validateLearningCache({sessions: v.sessions, selectedUid: '', input: '', draft: '', sources: []})
  validateLearningActions(v.actions, v.scope)
  if (v.cache !== undefined) validateLearningCache(v.cache)
  if (v.recoveryCache !== undefined) validateLearningCache(v.recoveryCache)
  return v
}
export async function captureCommunityLearning(profileId: string): Promise<CommunityLearningBackup> {
  const scope = communityLearningScope(profileId)
  const cacheKey = `note-flow-ai-local:v1:${scope}`
  const readCache = (key: string) => {const raw=localStorage.getItem(key); return raw === null ? undefined : validateLearningCache(JSON.parse(raw))}
  const cache = readCache(cacheKey), recoveryCache = readCache(cacheKey+':recovery')
  const db = await learningDb(scope)
  let sessions: LearningSession[], operations: unknown[]
  try {
    const tx = db.transaction(['sessions', 'operations'], 'readonly')
    ;[sessions, operations] = await Promise.all([tx.objectStore('sessions').getAll(), tx.objectStore('operations').getAll()])
    await tx.done
  } finally {db.close()}
  const actions = await actionsDb(scope)
  try {
    const tx = actions.transaction(['drafts', 'operations'], 'readonly')
    const [drafts, results] = await Promise.all([tx.objectStore('drafts').getAll(), tx.objectStore('operations').getAll()])
    await tx.done
    if (scope !== communityLearningScope(profileId)) throw Error('学习空间已变化，请重新备份')
    return validateCommunityLearningBackup({schema: 'note-flow-community-learning', version: 1, scope, sessions, operations, actions: {drafts, operations: results}, cache, recoveryCache}, profileId)
  } finally {actions.close()}
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

/** Stage readable discussions and drafts before publishing a fresh profile.
 * Execution journals stay in the workspace recovery archive, never in live queues. */
export async function stageCommunityLearning(value: CommunityLearningBackup, targetProfileId: string) {
  const prepared = prepareLearningRestore(value)
  const scope = `community-${targetProfileId}`, db = await learningDb(scope)
  const sessionTx = db.transaction(['sessions', 'operations'], 'readwrite')
  try {
    const tx = sessionTx
    if (await tx.objectStore('sessions').count() || await tx.objectStore('operations').count()) {
      tx.abort(); await tx.done.catch(() => undefined); throw Error('学习恢复目标不是空空间')
    }
    for (const session of prepared.sessions) await tx.objectStore('sessions').add(session)
    await tx.done
  } catch (error) {
    try {sessionTx.abort()} catch {/* transaction may already have aborted */}
    await sessionTx.done.catch(() => undefined)
    throw error
  } finally {db.close()}
  const actions = await actionsDb(scope)
  const actionTx = actions.transaction(['drafts', 'operations'], 'readwrite')
  try {
    const tx = actionTx
    if (await tx.objectStore('drafts').count() || await tx.objectStore('operations').count()) {
      tx.abort(); await tx.done.catch(() => undefined); throw Error('成果恢复目标不是空空间')
    }
    for (const draft of value.actions.drafts) await tx.objectStore('drafts').add({...structuredClone(draft), scope})
    await tx.done
  } catch (error) {
    try {actionTx.abort()} catch {/* transaction may already have aborted */}
    await actionTx.done.catch(() => undefined)
    throw error
  } finally {actions.close()}
  const cacheKey = `note-flow-ai-local:v1:${scope}`
  for (const [suffix, original] of [['', prepared.cache], [':recovery', value.recoveryCache]] as const) {
    if (original === undefined) continue
    if (localStorage.getItem(cacheKey+suffix) !== null) throw Error('学习草稿恢复目标不是空空间')
    const cache = structuredClone(original)
    delete cache.pendingSend; delete cache.operation
    cache.epoch = LOCAL_LEARNING_EPOCH
    for (const session of cache.sessions) for (const message of session.messages) if (message.status === 'pending') {
      message.status = 'interrupted'; message.finishReason = 'process_exit'
    }
    validateLearningCache(cache)
    localStorage.setItem(cacheKey+suffix, JSON.stringify(cache))
  }
}
