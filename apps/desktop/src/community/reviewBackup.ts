import {exportNoteHistoryScope, importNoteHistoryScope, validateNoteHistoryArchive, type NoteHistoryArchive} from '../services/noteHistory'
import {exportConsolidationDraftArchive, restoreConsolidationDraftArchive, validateConsolidationDraftArchive, consolidationDraftSources, type ConsolidationDraftArchive} from '../services/consolidationDraft'
import {exportLogCaptureArchive, restoreLogCaptureArchive, validateLogCaptureArchive, type LogCaptureArchive} from '../services/logCaptureJournal'
import {communityLearningScope} from './learningBackup'

export interface CommunityReviewBackup {
  history: NoteHistoryArchive
  consolidation: ConsolidationDraftArchive
  logs: LogCaptureArchive
}
export async function validateCommunityReviewBackup(value: unknown, profileId: string): Promise<CommunityReviewBackup> {
  const v = value as CommunityReviewBackup, owner = `community-${profileId}`
  validateNoteHistoryArchive(v?.history, owner)
  const scope = v.consolidation?.scope
  if (typeof scope !== 'string' || !(scope === owner || scope.startsWith(`${owner}:reset:`) && scope.length > owner.length + 7)) throw Error('草稿备份空间无效')
  if (new Set(v.history.revisions.map(row => row.id)).size !== v.history.revisions.length) throw Error('笔记历史备份标识重复')
  validateConsolidationDraftArchive(v.consolidation, scope)
  await validateLogCaptureArchive(v.logs, scope)
  return v
}
export async function captureCommunityReview(profileId: string): Promise<CommunityReviewBackup> {
  const scope = communityLearningScope(profileId)
  const value = {history:await exportNoteHistoryScope(`community-${profileId}`), consolidation:await exportConsolidationDraftArchive(scope), logs:await exportLogCaptureArchive(scope)}
  if (scope !== communityLearningScope(profileId)) throw Error('草稿空间已变化，请重新备份')
  return validateCommunityReviewBackup(value, profileId)
}
/** Stage local review state only; keep original requests in the workspace archive. */
export async function stageCommunityReview(value: CommunityReviewBackup, profileId: string) {
  const scope = `community-${profileId}`
  await importNoteHistoryScope({...value.history, scope, revisions:value.history.revisions.map(row => ({...row, id:crypto.randomUUID(), scope}))}, scope)
  await restoreConsolidationDraftArchive({...value.consolidation, scope, drafts:value.consolidation.drafts.map(row => {
    const {request:_request, ...draft} = row
    return {...draft, scope, key:JSON.stringify([scope, [...consolidationDraftSources(row)].sort()]), operationUid:'', ready:row.operationUid ? false : row.ready}
  })}, scope)
  await restoreLogCaptureArchive({...value.logs, scope, captures:value.logs.captures.map(row => ({...row, scope}))}, scope)
}
