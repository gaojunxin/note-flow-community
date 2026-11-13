import {captureClientIntentArchive,validateClientIntentArchive,restoreClientIntentArchive,type ClientIntentArchive} from '../../services/clientIntentBackup'
import {captureBusinessRecoveryArchive,validateBusinessRecoveryArchive,restoreBusinessRecoveryArchive,type BusinessRecoveryArchive} from '../../services/businessRecoveryArchive'
import {stagedBusinessState} from '../../services/businessState'
import {captureLegacyKnowledge,validateLegacyKnowledge,type LegacyKnowledgeBackup} from '../legacyKnowledgeBackup'
import {validateCommunityVaultBackup,validateCommunityVaultSnapshot} from './vault'
import {captureCommunityReview, validateCommunityReviewBackup, stageCommunityReview, type CommunityReviewBackup} from '../reviewBackup'
import {fingerprintBackupValue} from '../backupFingerprint'
import {createLocalEntityRepository, decodePortableValue, encodePortableValue} from '@note-flow/core/community'
import {createWorkspaceKeyStore, validateWorkspaceKeyArchive, type WorkspaceKeyArchive, type WorkspaceKeyCredentials} from '@note-flow/core/workspace-key-store'
import type {LocalWorkspaceSnapshot} from '@note-flow/core/contracts'
import {captureEditionVault, type VaultBackup} from '../../services/vault'
import {COMMUNITY_PROFILE_KEY, createCommunityWorkspace} from '../workspace'
import {getCommunityWorkspace} from '../runtime'
import {exportCommunityFile} from '../fileExport'
import {notificationStorageKey, legacyNotificationStorageKey, validateNotificationBackup, type PcNotification} from '../../services/notificationPersistence'
import {captureCommunityLearning, communityLearningScope, stageCommunityLearning, validateCommunityLearningBackup, type CommunityLearningBackup} from '../learningBackup'

export interface LocalBackup {schema: 'note-flow-community-backup'; version: 1; exportedAt: string; workspace: LocalWorkspaceSnapshot; vault: VaultBackup | null;businessRecovery?:BusinessRecoveryArchive;clientIntents?:ClientIntentArchive;learning?:CommunityLearningBackup;notifications?:PcNotification[];workspaceKeys?:WorkspaceKeyArchive;review?:CommunityReviewBackup;sourceRestoreIncomplete?:boolean;legacyKnowledge?:LegacyKnowledgeBackup}
export interface LocalWorkspaceResetSummary {cards:number;cardReviewEvents:number;notes: number; tasks: number; projects: number; areas: number; folders: number; tags: number; focusSessions: number; recordings: number; attachments: number;learningSessions:number;learningResults:number;notifications:number}
export interface LocalWorkspaceResetPreview extends LocalWorkspaceResetSummary {pending: number; failed: number; conflicts: number; resetInProgress: boolean;noteJournal?:Record<string,unknown>;taskNoteIntents?:import('../../services/clientIntentRepository').TaskNoteResetObservation}
async function captureLocalBackup(): Promise<LocalBackup> {
  const workspace = await getCommunityWorkspace()
  const profileId = workspace.context.profileId
  const notificationsPort=stagedBusinessState(`community-${profileId}`,()=>{if(localStorage.getItem(COMMUNITY_PROFILE_KEY)!==profileId)throw Error('空间已切换，请重新备份')})
  const notificationsRaw=await notificationsPort.read('notifications:'+notificationStorageKey(location.origin,profileId))
  const notifications = validateNotificationBackup(JSON.parse(notificationsRaw ?? localStorage.getItem(notificationStorageKey(location.origin, profileId)) ?? localStorage.getItem(legacyNotificationStorageKey(profileId)) ?? '[]'))
  const businessRecovery=await captureBusinessRecoveryArchive(profileId,location.origin,notificationsPort,()=>communityLearningScope(profileId))
  const clientIntents=await captureClientIntentArchive('local',`community-${profileId}`)
  const keys = createWorkspaceKeyStore({scope:()=>`community-${profileId}`, generation:()=>0})
  let workspaceKeys: WorkspaceKeyArchive
  try {workspaceKeys = await keys.exportArchive()} finally {await keys.close()}
  const value: LocalBackup = {schema: 'note-flow-community-backup', version: 1, exportedAt: new Date().toISOString(), businessRecovery,clientIntents, workspace: await workspace.host.exportWorkspace(workspace.context), vault: await captureEditionVault(profileId), learning: await captureCommunityLearning(profileId), notifications, workspaceKeys, review:await captureCommunityReview(profileId),legacyKnowledge:await captureLegacyKnowledge(profileId)}
  if (localStorage.getItem(COMMUNITY_PROFILE_KEY) !== profileId) throw new Error('空间已切换，请重新备份')
  return value
}
async function captureFingerprint(value: LocalBackup) {
  // Export timestamps describe collection, not mutations. Retain every actual field,
  // including unknown properties, typed bytes and the contents of Blob attachments.
  const logical = {...value, exportedAt:'', workspace:{...value.workspace, exportedAt:''}, vault:value.vault ? {...value.vault, exportedAt:''} : null}
  return fingerprintBackupValue(logical)
}
export async function createLocalBackup(): Promise<LocalBackup> {
  const first = await captureLocalBackup(), fingerprint = await captureFingerprint(first)
  const second = await captureLocalBackup()
  if (fingerprint !== await captureFingerprint(second)) throw new Error('备份期间本地数据发生变化，未导出备份；请暂停编辑后重试')
  if (localStorage.getItem(COMMUNITY_PROFILE_KEY) !== first.workspace.profileId) throw new Error('空间已切换，请重新备份')
  return first
}
export async function downloadLocalBackup(value: LocalBackup) {
  return exportCommunityFile(new Blob([JSON.stringify(await encodePortableValue(value))], {type: 'application/json'}), `jiyu-community-${new Date().toISOString().slice(0, 10)}.json`)
}
export async function restoreLocalBackup(source: unknown,options?:{workspaceCredentials?:WorkspaceKeyCredentials;confirmDamagedRestore?:()=>Promise<boolean>}) {
  const decoded = (source as {kind?: string})?.kind ? decodePortableValue(source as Parameters<typeof decodePortableValue>[0]) : source
  const value = decoded as LocalBackup | LocalWorkspaceSnapshot
  const snapshot = value?.schema === 'note-flow-community-backup' && value.version === 1 ? value.workspace : value?.schema === 'note-flow-community-workspace' ? value : null
  if (!snapshot) throw new Error('不是有效的社区本地备份；官方备份请使用版本切换档案导入')
  const legacyKnowledge=value.schema==='note-flow-community-backup'&&value.legacyKnowledge!==undefined?validateLegacyKnowledge(value.legacyKnowledge,snapshot.profileId):undefined
  const learning = value.schema === 'note-flow-community-backup' && value.learning !== undefined ? validateCommunityLearningBackup(value.learning, snapshot.profileId) : undefined
  if(value.schema==='note-flow-community-backup'&&value.clientIntents!==undefined)validateClientIntentArchive(value.clientIntents)
  const businessRecovery=value.schema==='note-flow-community-backup'&&value.businessRecovery!==undefined?validateBusinessRecoveryArchive(value.businessRecovery):undefined
  const notifications = value.schema === 'note-flow-community-backup' && value.notifications !== undefined ? validateNotificationBackup(value.notifications) : undefined
  const workspaceKeys = value.schema === 'note-flow-community-backup' && value.workspaceKeys !== undefined ? validateWorkspaceKeyArchive(value.workspaceKeys, `community-${snapshot.profileId}`) : undefined
  if (workspaceKeys?.records.length && !options?.workspaceCredentials) throw new Error('恢复加密空间前需要在本机验证口令或恢复码')
  const review = value.schema === 'note-flow-community-backup' && value.review !== undefined ? await validateCommunityReviewBackup(value.review, snapshot.profileId) : undefined
  const vault = value.schema === 'note-flow-community-backup' && value.vault !== undefined && value.vault !== null ? validateCommunityVaultBackup(value.vault) : undefined
  validateCommunityVaultSnapshot(snapshot)
  const originalProfile = localStorage.getItem(COMMUNITY_PROFILE_KEY)
  const next = createCommunityWorkspace(crypto.randomUUID())
  const keys = createWorkspaceKeyStore({scope:()=>`community-${next.context.profileId}`, generation:()=>0})
  let keyPlan: Awaited<ReturnType<typeof keys.prepareArchiveRestore>> | undefined
  try {
    if (workspaceKeys?.records.length) {
      const scope = `community-${next.context.profileId}`
      const relocated = {...workspaceKeys, scope, records:workspaceKeys.records.map(record=>({...record, storageKey:JSON.stringify([scope, record.workspaceUid])}))}
      keyPlan = await keys.prepareArchiveRestore(relocated, options!.workspaceCredentials!)
      if (localStorage.getItem(COMMUNITY_PROFILE_KEY) !== originalProfile) throw new Error('空间已切换，未开始恢复')
    }
    await next.initialize(); await next.host.restoreWorkspace(next.context, snapshot)
    if (vault) await createLocalEntityRepository(next.host, next.context, 'vault_backup').create({ownerId:vault.ownerId, backup:vault, retention:'original-owner-ciphertext'})
    // 仅在新空间保存惰性档案；不打开卡片业务库，也不恢复其outbox执行资格。
    if(legacyKnowledge)await createLocalEntityRepository(next.host,next.context,'legacy_knowledge_recovery_archive').create({archive:legacyKnowledge,retention:'inert-original-database'})
    if (learning) {
      await createLocalEntityRepository(next.host, next.context, 'learning_recovery_archive').create({archive: learning, retention: 'original-scope-inert-journals'})
      await stageCommunityLearning(learning, next.context.profileId)
    }
    if (review) {
      await createLocalEntityRepository(next.host, next.context, 'review_recovery_archive').create({archive:review, retention:'original-scope-inert-requests'})
      await stageCommunityReview(review, next.context.profileId)
    }
    if (keyPlan) await keyPlan.commit()
    if(value.schema==='note-flow-community-backup'&&value.clientIntents)await restoreClientIntentArchive(value.clientIntents,'local',`community-${next.context.profileId}`)
    if(businessRecovery)await restoreBusinessRecoveryArchive(businessRecovery,stagedBusinessState(`community-${next.context.profileId}`,()=>{if(localStorage.getItem(COMMUNITY_PROFILE_KEY)!==originalProfile)throw Error('空间已切换，未启用恢复空间')}))
    if (notifications) {
      // 新空间尚未启用；只恢复本机历史，不赋予远端已读队列执行资格。
      const port=stagedBusinessState(`community-${next.context.profileId}`,()=>{if(localStorage.getItem(COMMUNITY_PROFILE_KEY)!==originalProfile)throw Error('空间已切换，未启用恢复空间')})
      await port.write('notifications:'+notificationStorageKey(location.origin,next.context.profileId),null,JSON.stringify(notifications))
    }
    if (localStorage.getItem(COMMUNITY_PROFILE_KEY) !== originalProfile) throw new Error('空间已切换，未启用恢复空间')
    localStorage.setItem(COMMUNITY_PROFILE_KEY, next.context.profileId)
    window.dispatchEvent(new Event('note-flow:community-profile-change'))
    return value
  } finally {keyPlan?.dispose(); await keys.close(); await next.dispose()}
}
export async function previewLocalWorkspaceReset(): Promise<LocalWorkspaceResetPreview> {throw new Error('社区本地空间不是同步缓存，不能通过服务器重建；请导出完整备份或恢复到新空间')}
export async function resetLocalWorkspace(_options?:{discard?:unknown;taskNoteIntents?:import('../../services/clientIntentRepository').TaskNoteResetObservation}): Promise<LocalWorkspaceResetSummary> {throw new Error('社区本地空间不能从服务器重建，原数据保持保留')}
