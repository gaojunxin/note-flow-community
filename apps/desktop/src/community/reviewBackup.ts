import {reviewBinding} from '../services/reviewRepository'
import {exportSeriesDraftArchive,validateSeriesDraftArchive,restoreSeriesDraftArchive,type SeriesDraftArchive} from '../services/aiNoteSeriesDraft'
import {exportNoteHistoryScope, importNoteHistoryScope, validateNoteHistoryArchive, type NoteHistoryArchive} from '../services/noteHistory'
import {exportConsolidationDraftArchive, restoreConsolidationDraftArchive, validateConsolidationDraftArchive, consolidationDraftSources, type ConsolidationDraftArchive} from '../services/consolidationDraft'
import {exportLogCaptureArchive, restoreLogCaptureArchive, validateLogCaptureArchive, type LogCaptureArchive} from '../services/logCaptureJournal'
import {communityLearningScope} from './learningBackup'

export interface CommunityReviewBackup {
  history: NoteHistoryArchive
  consolidation: ConsolidationDraftArchive
  logs: LogCaptureArchive
  series?:SeriesDraftArchive
}
export async function validateCommunityReviewBackup(value: unknown, profileId: string): Promise<CommunityReviewBackup> {
  const v = value as CommunityReviewBackup, owner = `community-${profileId}`
  validateNoteHistoryArchive(v?.history, owner)
  const scope = v.consolidation?.scope
  if (typeof scope !== 'string' || !(scope === owner || scope.startsWith(`${owner}:reset:`) && scope.length > owner.length + 7)) throw Error('草稿备份空间无效')
  if (new Set(v.history.revisions.map(row => row.id)).size !== v.history.revisions.length) throw Error('笔记历史备份标识重复')
  validateConsolidationDraftArchive(v.consolidation, scope)
  if(v.series)validateSeriesDraftArchive(v.series,scope)
  await validateLogCaptureArchive(v.logs, scope)
  return v
}
export async function captureCommunityReview(profileId: string): Promise<CommunityReviewBackup> {
  const scope = communityLearningScope(profileId)
  const value = {history:await exportNoteHistoryScope(`community-${profileId}`), consolidation:await exportConsolidationDraftArchive(scope), logs:await exportLogCaptureArchive(scope),series:await exportSeriesDraftArchive(scope)}
  if (scope !== communityLearningScope(profileId)) throw Error('草稿空间已变化，请重新备份')
  return validateCommunityReviewBackup(value, profileId)
}
/** 仅预写可编辑审阅材料；原请求和执行进度保留在惰性档案，不自动运行。 */
export async function stageCommunityReview(value: CommunityReviewBackup, profileId: string) {
  const scope = `community-${profileId}`,binding=reviewBinding(`community-${profileId}`,true)
  binding.check()
  await importNoteHistoryScope({...value.history, scope, revisions:value.history.revisions.map(row => ({...row, id:crypto.randomUUID(), scope}))}, scope, true)
  binding.check()
  await restoreConsolidationDraftArchive({...value.consolidation, scope, drafts:value.consolidation.drafts.map(row => {
    const {request:_request, ...draft} = row
    return {...draft, scope, key:JSON.stringify([scope, [...consolidationDraftSources(row)].sort()]), operationUid:'', ready:row.operationUid ? false : row.ready}
  })}, scope, true)
  binding.check()
  if(value.series)await restoreSeriesDraftArchive({...value.series,scope,drafts:value.series.drafts.map(row=>({...row,scope,key:JSON.stringify([scope,row.sessionUid])}))},scope,true)
  binding.check()
  await restoreLogCaptureArchive({...value.logs, scope, captures:value.logs.captures.map(row => ({...row, scope})),archives:value.logs.archives?.map(row=>({...row,scope}))}, scope,true)
  binding.check()
}
