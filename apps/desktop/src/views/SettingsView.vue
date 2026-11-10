<script setup lang="ts">
import {clearReadingProgress} from '../services/readingProgress'
import {syncConflictStamp} from '@note-flow/core/sync-presentation'
import {syncTaskNoteQueue} from '../services/tasks'
import {syncKnowledgeQueue} from '../services/knowledge'
import {syncQueueInspectionService} from '../services/syncQueueInspection'
import {appInfo} from '../services/appInfo'
import {failedSyncDiagnostic,type FailedSyncOperation} from '../services/failedSyncOperations'
import {decodePortableValue} from '@note-flow/core/community'
import {createTickTickScopeRepair,type TickTickScopeInspection} from '../services/tickTickScopeRepair'
import {captureFileExportBoundary} from '../services/fileExportBoundary'
import {createBrowserPersonalBackup} from '../services/browserPersonalBackup'
import {acquireInert} from "../services/inertLease"
import {confirmRestoreRepair} from '../services/confirmRestoreRepair'
import {accountLifecycleRevision} from '../services/accountStorage'
import {flushLocalDrafts} from '../services/localDraftLifecycle'
import LocalRestoreNotice from '../components/LocalRestoreNotice.vue'
import AppLockSettings from '../components/AppLockSettings.vue'
import SyncReadinessPanel from '../components/SyncReadinessPanel.vue'
import UserManagementView from './UserManagementView.vue'
import AiChannelSettings from '../components/AiChannelSettings.vue'
import {aiClientConfig,testAiClientConnection,type AiChannel} from '../services/aiClientConfig'
import {isCommunityEdition} from '../services/clientCapabilities'
import AboutProduct from '../components/AboutProduct.vue'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter, useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNotesStore } from '../stores/notes'
import { useNotificationsStore } from '../stores/notifications'
import api from '../services/api'
import { deleteLocalObsidianImports, importErrorMessage, importObsidianScan, localObsidianImportSummary, retryObsidianAttachments, retryObsidianFailures, scanObsidianVault, type AttachmentImportRecord, type ImportRecord, type ObsidianScan, type RemoteImageImportRecord, type TaskImportRecord } from '../services/obsidianImport'
import { repairMojibake } from '../utils/textEncoding'
import { localFocusService,localRecordingsService } from '../services/localPersonal'
import { isDesktopClient } from '../services/serverConfig'
import { activeProfileId, currentProfile, ensureDesktopProfile, syncAvailable } from '../services/profiles'
import {prepareBackupMedia} from '../services/localBackupMedia'
import { createLocalBackup, downloadLocalBackup, previewLocalWorkspaceReset, resetLocalWorkspace, restoreLocalBackup, type LocalWorkspaceResetPreview } from '../services/localBackup'
import {foldersService} from '../services/folders'
import type {FolderConflict} from '../services/folderSync'
import { tasksService } from '../services/tasks'
import { workspaceService } from '../services/workspace'
import { aiProviderService, type AiProviderConfig } from '../services/aiProvider'
import {taskFailureDiagnostic} from '../services/taskFailureDiagnostic'
import { confirmDialog, promptDialog } from '../services/productDialog'
import { invoke } from '@tauri-apps/api/core'
import {buildLocalVault,previewLocalVault,createLocalVaultWriter,type LocalVaultPlan,type LocalArchiveSnapshot,type Applied} from '../services/localVaultArchive'
import {blobDigest} from '../services/blobDigest'
import {parseLocalTickTick} from '../services/localTickTick'
import {tagsService} from '../services/tags'
import {saveLocalExport} from '../services/localFileExport'
import {reconcileDeletedAttachments,localAiAttachmentItems,readLocalAiAttachment,queueAttachment,queueTaskAttachment,removeLocalAttachment} from '../services/attachments'
import { validateExportArchive } from '../services/exportArchive'
import { appDataDir, appConfigDir, join } from '@tauri-apps/api/path'
import { beginPcSyncReset, endPcSyncReset } from '../services/syncResetGuard'
import { accountDataResetService, type AccountResetPreview } from '../services/accountDataReset'
import { acceptServerSyncEpoch } from '../services/syncEpoch'
import { createCanvasService } from '../services/canvases'
import { clearVault } from '../services/vault'
import { clearVaultSyncState } from '../services/vaultSync'
import { clearVaultSession } from '../services/vaultSession'
import DataProtectionView from './DataProtectionView.vue'
import AccountSettings from '../components/AccountSettings.vue'
import EditionTransferPanel from '../components/EditionTransferPanel.vue'
import SyncIssueCard from '../components/SyncIssueCard.vue'
import {classifySyncIssue,type SyncActionFeedback} from '@note-flow/core/sync-presentation'
import SyncProgressPanel from '../components/SyncProgressPanel.vue'
import ConflictBatchPanel from '../components/ConflictBatchPanel.vue'
import {pausePcSync} from '../services/syncResetGuard'
import {syncDelivery} from '../services/syncEvents'
import {syncRuntimeIssues} from '../services/syncRuntimeIssues'
import {trackSync,syncActivity} from '../services/syncActivity'

const auth = useAuthStore(), notes = useNotesStore(), notifications = useNotificationsStore(), router = useRouter(), route=useRoute()
const runtimeSyncIssues=computed(()=>syncRuntimeIssues({deliveryError:syncDelivery.error,notePhase:notes.syncPhase,noteError:notes.syncError}))
const failedTasks=ref<Awaited<ReturnType<typeof tasksService.failedOperations>>>([])
const retryingTask=ref('')
const taskConflicts=ref<Array<{conflictId:string;localEntity?:{title?:string;deleted?:boolean};serverEntity?:{title?:string;deleted?:boolean}}>>([])
const workspaceConflicts=ref<Array<{conflictId:string;entityType:string;localEntity?:{name?:string;content?:string;deleted?:boolean};serverEntity?:{name?:string;content?:string;deleted?:boolean}}>>([])
const displayName = computed(() => {
  const candidates = [auth.user?.nickName, auth.user?.userName]
  const value = candidates.find(item => typeof item === 'string' && item.trim() && !item.includes('\uFFFD'))
  return value ? repairMojibake(value) : '迹语用户'
})
const syncEnabled = ref(syncAvailable()&&localStorage.getItem('note-flow-pc-sync-enabled') !== 'false'), message = ref('')
const syncScopeRevision=ref(accountLifecycleRevision())
const refreshSyncScope=()=>{syncScopeRevision.value=accountLifecycleRevision()}
const profile = computed(()=>{void syncScopeRevision.value;return currentProfile()})
const online=ref(navigator.onLine!==false)
const updateOnline=()=>{online.value=navigator.onLine!==false}
const serverDisplay=window.location.origin
const localStorageLocation=ref('正在读取…'), localStorageRoot=ref(''), localMediaRoot=ref(''), storageMessage=ref('')
async function loadStorageLocation(){
 if(!isDesktopClient()){localStorageLocation.value=`浏览器 IndexedDB · ${window.location.origin}`;return}
 try{const mediaRoot=await appDataDir(),root=isCommunityEdition?mediaRoot:await appConfigDir();localStorageRoot.value=root;localMediaRoot.value=mediaRoot;const owner=currentProfile()?.storageKey;if(!isCommunityEdition&&!owner){localStorageLocation.value='当前本地空间尚未初始化';return}localStorageLocation.value=await join(root,isCommunityEdition?'community-workspace-v1.sqlite':`note-flow-v2-${owner!.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)}.db`)}catch{localStorageLocation.value='无法读取本机路径，请重新打开客户端后重试'}
}
async function copyStorageLocation(){try{await navigator.clipboard.writeText(localStorageLocation.value);storageMessage.value='已复制数据库位置'}catch{storageMessage.value='复制失败，请手动选择路径复制'}}
const connected = computed(()=>syncAvailable()&&Boolean(auth.token))
const canManageUsers = computed(()=>!isCommunityEdition&&connected.value&&(auth.user?.roles?.includes('admin')||auth.user?.permissions?.includes('*:*:*')))
const dataBusy = ref(false), dataMessage = ref(''), includeObsidianTasks = ref(false)
const lastPersonalBackup=ref(localStorage.getItem(`note-flow-last-personal-backup:${archiveOwner()}`)||'')
const resetPreview=ref<LocalWorkspaceResetPreview|null>(null)
const cloudResetOpen=ref(false),cloudResetBusy=ref(false),cloudResetMessage=ref(''),cloudResetPreview=ref<AccountResetPreview|null>(null)
const cloudResetPassword=ref(''),cloudResetConfirmation=ref(''),deleteAiCredentials=ref(false),deleteCloudVault=ref(false),createCloudResetBackup=ref(true)
const cloudResetPasswordInput=ref<HTMLInputElement|null>(null),cloudResetPasswordVisible=ref(false)
const cloudResetPanel=ref<HTMLElement|null>(null)
let resetOrigin:HTMLElement|null=null, resetOverflow='', releaseResetInert=()=>{}, resetLocked=false
function releaseResetDialog(){
  document.removeEventListener('keydown',resetDialogKeydown,true)
  if(!resetLocked)return
  resetLocked=false
  releaseResetInert()
  document.body.style.overflow=resetOverflow
  if(resetOrigin?.isConnected)resetOrigin.focus()
}
function resetDialogKeydown(event:KeyboardEvent){
  if(!cloudResetOpen.value)return
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!cloudResetBusy.value)cloudResetOpen.value=false;return}
  if(event.key!=='Tab')return
  const panel=cloudResetPanel.value;if(!panel)return
  const controls=[...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length)
  const first=controls[0],last=controls.at(-1),active=document.activeElement
  if(!first){event.preventDefault();panel.focus()}
  else if(active===panel||!panel.contains(active)||(event.shiftKey&&active===first)||(!event.shiftKey&&active===last)){event.preventDefault();(event.shiftKey?last:first)?.focus()}
}
watch(cloudResetOpen,async open=>{
  if(!open){releaseResetDialog();return}
  resetOrigin=document.activeElement instanceof HTMLElement?document.activeElement:null
  resetOverflow=document.body.style.overflow;const root=document.getElementById('app');releaseResetInert=acquireInert(root)
  resetLocked=true;document.body.style.overflow='hidden';document.addEventListener('keydown',resetDialogKeydown,true)
  await nextTick();if(cloudResetOpen.value)cloudResetPanel.value?.focus()
},{flush:'post'})
watch(()=>route.fullPath,()=>{cloudResetOpen.value=false;releaseResetDialog()})
onBeforeUnmount(releaseResetDialog)
const cloudResetIdempotencyKey=ref('')
const cloudResetChallengeToken=ref('')
const CLOUD_RESET_RECOVERY_KEY='note-flow-pc-data-reset-recovery'
const obsidianScan = ref<ObsidianScan | null>(null), obsidianBusy = ref(false), obsidianMessage = ref(''), obsidianProgress = ref('')
const obsidianDialogOpen = ref(false)
const obsidianFailureDetailsOpen = ref(true)
const remoteImagePolicy = ref<'preserve'|'private'>('preserve')
const obsidianOrganization=ref<'folders'|'flat'>('folders'),localImportSummary=ref({notes:0,batches:0})
const obsidianTargetAreaUid=ref(''),obsidianTargetProjectUid=ref(''),obsidianImportStandaloneFiles=ref(true)
const obsidianProjectStrategy=ref<'none'|'existing'|'top-level-folders'>('none')
const obsidianAreas=ref<Array<{uid:string;name:string}>>([]),obsidianProjects=ref<Array<{uid:string;name:string;areaUid:string;status?:string}>>([])
const visibleObsidianProjects=computed(()=>obsidianProjects.value.filter(project=>!obsidianTargetAreaUid.value||project.areaUid===obsidianTargetAreaUid.value))
const obsidianProjectFolders=computed(()=>[...new Set((obsidianScan.value?.items||[]).map(item=>item.sourcePath.replace(/\\/g,'/').split('/').filter(Boolean)[1]).filter(Boolean))])
async function loadObsidianScopes(){const [areas,projects]=await Promise.all([workspaceService.areas(),workspaceService.projects(undefined,true)]);obsidianAreas.value=areas;obsidianProjects.value=projects}
watch(obsidianTargetAreaUid,()=>{if(obsidianTargetProjectUid.value&&!visibleObsidianProjects.value.some(project=>project.uid===obsidianTargetProjectUid.value))obsidianTargetProjectUid.value=''})
watch(obsidianTargetProjectUid,value=>{const project=obsidianProjects.value.find(item=>item.uid===value);if(project)obsidianTargetAreaUid.value=project.areaUid})
type ArchiveDecision = { entity: string; uid: string; path: string; title: string; action: 'create'|'update'|'skip'|'conflict'|'failed'; message: string }
type ArchivePreview = { batchUid?: string; archiveDigest: string; total: number; counts: Record<string, number>; items: ArchiveDecision[] }
const obsidianArchiveFile = ref<File | null>(null), obsidianArchivePreview = ref<ArchivePreview | null>(null)
const tickTickScopeInspection=ref<TickTickScopeInspection|null>(null)
let tickTickScopeSession:ReturnType<typeof createTickTickScopeRepair>|undefined
const tickTickScopeReasons:Record<string,string>={missing_id:'缺少来源任务 ID',not_imported:'未找到匹配的导入记录',unavailable:'任务不可用或已移动',changed_list:'清单已变化',modified:'导入后已修改',hierarchy:'父子任务需一并核对'}
type TickTickPreview = { digest:string;total:number;lists:number;tags:number;completed:number;abandoned:number;dated:number;recurring:number;warnings:string[] }
const tickTickFile=ref<File|null>(null),tickTickPreview=ref<TickTickPreview|null>(null),tickTickBusy=ref(false),tickTickMessage=ref(''),tickTickBatchUid=ref(''),tickTickResult=ref<{success:number;skipped:number;failed:number;errors:string[]}|null>(null)
const localTickTickUids=ref<string[]>([])
const importResult = ref<{ batchUids: string[]; total: number; success: number; skipped: number; failed: number; records: ImportRecord[]; attachmentSuccess:number;attachmentFailed:number;attachmentRecords:AttachmentImportRecord[];remoteImageSuccess:number;remoteImageFailed:number;remoteImagePreserved?:number;remoteImageRecords:RemoteImageImportRecord[];taskSuccess?:number;taskFailed?:number;taskRecords?:TaskImportRecord[] } | null>(null)
type SettingsTab = 'security' | 'users' | 'account' | 'sync' | 'general' | 'appearance' | 'editor' | 'tasks' | 'focus' | 'ai' | 'data' | 'protection' | 'about'
// 社区版不提供服务器账号与同步设置；旧书签和内部跳转同样落到本地通用设置。
function requestedSettingsTab(value:unknown):SettingsTab{
  const fallback=isCommunityEdition?'general':'account'
  if(isCommunityEdition&&['account','sync','users'].includes(String(value)))return fallback
  return typeof value==='string'&&['security','users','account','sync','general','appearance','editor','tasks','focus','ai','data','protection','about'].includes(value)?value as SettingsTab:fallback
}
const activeTab = ref<SettingsTab>(requestedSettingsTab(route.query.tab))
const accountEditor=ref<InstanceType<typeof AccountSettings>|null>(null),userEditor=ref<InstanceType<typeof UserManagementView>|null>(null)
async function selectSettingsTab(tab:SettingsTab,navigate=true){tab=requestedSettingsTab(tab);if(tab===activeTab.value)return true;if(accountEditor.value && !await accountEditor.value.requestLeave())return false;if(userEditor.value&&!await userEditor.value.requestLeave())return false;activeTab.value=tab;if(navigate&&route.query.tab!==tab)await router.replace({query:{...route.query,tab}});return true}
onBeforeRouteUpdate(to=>selectSettingsTab(requestedSettingsTab(to.query.tab),false))
onBeforeRouteLeave(async()=>{if(accountEditor.value&&!await accountEditor.value.requestLeave())return false;return userEditor.value?.requestLeave()??true})
const settingsTabs: Array<{ key: SettingsTab; label: string; icon: string }> = [
  { key: 'account', label: '账号', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20c.7-3.2 3.3-5 7.5-5s6.8 1.8 7.5 5' },
  { key: 'security', label: '隐私安全', icon: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3ZM9 12l2 2 4-4' },
  { key: 'sync', label: '同步', icon: 'M7 7a7 7 0 0 1 12 4M19 4v7h-7M17 17a7 7 0 0 1-12-4M5 20v-7h7' },
  { key: 'general', label: '通用', icon: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6' },
  { key: 'appearance', label: '外观', icon: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
  { key: 'editor', label: '编辑器', icon: 'M5 3.5h9l4 4v13H5zM14 3.5v4h4M8 16l5.8-5.8 2 2L10 18H8z' },
  { key: 'tasks', label: '任务提醒', icon: 'M18 9a6 6 0 0 0-12 0c0 6-2.5 6-2.5 8h17c0-2-2.5-2-2.5-8ZM10 21h4' },
  { key: 'focus', label: '专注回顾', icon: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 8v5l3 2M9 2h6' },
  { key: 'ai', label: 'AI 服务', icon: 'M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3ZM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z' },
  { key: 'data', label: '导入导出', icon: 'M12 3v12M8 11l4 4 4-4M4 18v2h16v-2' },
  { key: 'about', label: '关于迹语', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6M12 7.5v.5' }
]
const settingsGroups=[
 {key:'account',label:isCommunityEdition?'隐私安全':'账号安全',keys:['account','security']}, {key:'data',label:isCommunityEdition?'数据管理':'数据同步',keys:['sync','data']},
 {key:'preferences',label:'使用偏好',keys:['general','appearance','editor','tasks','focus']},
 {key:'ai',label:'AI 扩展',keys:['ai']}, {key:'app',label:'应用管理',keys:['about']}
].map(group=>({...group,tabs:settingsTabs.filter(tab=>group.keys.includes(tab.key)&&(!isCommunityEdition||!['account','sync','users'].includes(tab.key)))}))

const accent = ref(localStorage.getItem('note-flow-pc-accent') || '#0f6b4f')
const autoDailyBrief=ref(localStorage.getItem('note-flow-home-daily-brief')==='true')
const startPage = ref(localStorage.getItem('note-flow-pc-start-page') || '/home')
const focusSettings = ref({ focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, roundsBeforeLongBreak: 4, autoStartBreak: false, version: 0 })
const obsidianImportPercent=computed(()=>{const match=obsidianProgress.value.match(/(\d+)\s*\/\s*(\d+)/);return match&&Number(match[2])?Math.round(Number(match[1])/Number(match[2])*100):obsidianBusy.value?8:0})
const obsidianFailures=computed(()=>{
  const result=importResult.value
  if(!result)return[]
  const failures=[
    ...result.records.filter(item=>item.result==='failed').map(item=>({kind:'笔记',path:item.sourcePath,context:'',reason:item.errorMessage||'导入失败'})),
    ...result.attachmentRecords.filter(item=>item.result==='failed').map(item=>({kind:'附件',path:item.sourcePath,context:item.noteSourcePath,reason:item.errorMessage||'附件导入失败'})),
    ...result.remoteImageRecords.filter(item=>item.result==='failed').map(item=>({kind:'外链图片',path:item.url,context:item.noteSourcePath,reason:item.errorMessage||'图片转存失败'})),
    ...(result.taskRecords||[]).filter(item=>item.result==='failed').map(item=>({kind:'任务',path:item.title,context:item.noteSourcePath,reason:item.errorMessage||'任务创建失败'}))
  ]
  const represented={note:failures.filter(item=>item.kind==='笔记').length,attachment:failures.filter(item=>item.kind==='附件').length,remote:failures.filter(item=>item.kind==='外链图片').length,task:failures.filter(item=>item.kind==='任务').length}
  if(result.failed>represented.note)failures.push({kind:'笔记',path:`另有 ${result.failed-represented.note} 篇笔记`,context:'',reason:'导入服务未返回逐条错误，请重试或检查应用日志。'})
  if(result.attachmentFailed>represented.attachment)failures.push({kind:'附件',path:`另有 ${result.attachmentFailed-represented.attachment} 个附件`,context:'',reason:'附件处理失败，但未返回逐条错误。'})
  if(result.remoteImageFailed>represented.remote)failures.push({kind:'外链图片',path:`另有 ${result.remoteImageFailed-represented.remote} 个远程图片`,context:'',reason:'远程图片未能转存，原链接已保留。'})
  if((result.taskFailed||0)>represented.task)failures.push({kind:'任务',path:`另有 ${(result.taskFailed||0)-represented.task} 个任务`,context:'',reason:'任务识别后创建失败，但未返回逐条错误。'})
  return failures
})
watch(()=>obsidianFailures.value.length,async count=>{if(!count)return;await nextTick();document.querySelector('.obsidian-failure-report')?.scrollIntoView({block:'nearest',behavior:'smooth'})})
const aiConfig=ref<AiProviderConfig|null>(null),aiProvider=ref<'openai'|'deepseek'>('deepseek'),aiModel=ref('deepseek-flash'),aiApiKey=ref(''),aiEnabled=ref(true),aiBusy=ref(false),aiMessage=ref('')
const aiSettings=ref<InstanceType<typeof AiChannelSettings>|null>(null),selectedAiChannel=ref<AiChannel>(aiClientConfig().channel)
let aiTestController:AbortController|undefined
onBeforeUnmount(()=>aiTestController?.abort())
async function testAccountService(){if(aiBusy.value)return;aiBusy.value=true;aiMessage.value='正在测试账号服务…';aiTestController=new AbortController();try{await testAiClientConnection({...aiClientConfig(),channel:'server'},undefined,aiTestController.signal);aiMessage.value='连接成功，已使用账号服务。'}catch(source){aiMessage.value=source instanceof Error?source.message:'连接测试失败，请检查账号服务'}finally{aiBusy.value=false;aiTestController=undefined}}
async function selectAiChannel(channel:AiChannel){selectedAiChannel.value=channel;if(channel==='server'&&connected.value&&!isCommunityEdition)await loadAiConfig()}
const loadedTabs=new Set<SettingsTab>()
function savePreference(key: string, value: string | number) { localStorage.setItem(key, String(value)) }
function chooseAccent(value: string) { accent.value = value; localStorage.setItem('note-flow-pc-accent', value); document.documentElement.style.setProperty('--pc-primary', value) }
function returnToWorkspace() { router.push(sessionStorage.getItem('note-flow-pc-last-workspace') || startPage.value || '/home') }
const focusMessage=ref('')
async function saveFocusSettings() {try{focusSettings.value=(isCommunityEdition||isDesktopClient())?await localFocusService.saveSettings(focusSettings.value):(await api.put<{data:typeof focusSettings.value}>('/focus/settings', focusSettings.value)).data.data;focusMessage.value='已保存'}catch{focusMessage.value='保存失败，请重试';try{if(localArchiveMode)focusSettings.value=await localFocusService.settings()}catch{/* keep the current form for retry */}}}
async function loadAiConfig(){if(!connected.value||!online.value){aiMessage.value='账号服务需要联网；本地模型可独立使用';return;}try{const value=await aiProviderService.get();aiConfig.value=value;if(value.providerType)aiProvider.value=value.providerType;if(value.model)aiModel.value=value.model;aiEnabled.value=value.enabled!==false}catch(source){aiMessage.value=source instanceof Error?source.message:'AI 配置加载失败'}}
function chooseAiProvider(){aiModel.value=aiProvider.value==='openai'?'gpt-4.1-mini':'deepseek-flash'}
async function saveAiConfig(){if(!connected.value||aiBusy.value)return;aiBusy.value=true;aiMessage.value='';try{aiConfig.value=await aiProviderService.save({providerType:aiProvider.value,apiKey:aiApiKey.value||undefined,model:aiModel.value,enabled:aiEnabled.value});aiApiKey.value='';if(!await aiSettings.value?.activateServer())throw Error('账号模型已保存，但本机调用方式未切换，请重试。');aiMessage.value='账号模型已保存并启用'}catch(source){aiMessage.value=source instanceof Error?source.message:'保存失败'}finally{aiBusy.value=false}}
async function testAiConfig(){aiBusy.value=true;aiMessage.value='正在测试连接…';try{await aiProviderService.test();await loadAiConfig();aiMessage.value='连接成功'}catch(source){await loadAiConfig();aiMessage.value=source instanceof Error?source.message:'连接失败'}finally{aiBusy.value=false}}
async function removeAiConfig(){if(!await confirmDialog({title:'删除个人 AI 授权？',message:'删除后将改用管理员默认服务；若系统未配置，AI 功能会停用。',tone:'danger',confirmText:'删除授权'}))return;aiBusy.value=true;try{await aiProviderService.remove();aiConfig.value=await aiProviderService.get();aiApiKey.value='';aiMessage.value='个人 AI 授权已删除'}finally{aiBusy.value=false}}

function saveSync() { if(!connected.value){syncEnabled.value=false;message.value='请先连接同步服务';return}localStorage.setItem('note-flow-pc-sync-enabled',String(syncEnabled.value));window.dispatchEvent(new Event('note-flow:sync-preference'));message.value=syncEnabled.value?'自动同步已开启':'自动同步已关闭' }
const failedChanges=ref<FailedSyncOperation[]>([]),failedChangesLoading=ref(false),failedChangesError=ref(''),retryingChange=ref('')
let failedChangesGeneration=0
async function loadFailedChanges(){
 const generation=++failedChangesGeneration,scope=archiveOwner(),revision=accountLifecycleRevision();failedChangesLoading.value=true
 const current=()=>generation===failedChangesGeneration&&scope===archiveOwner()&&revision===accountLifecycleRevision()
 try{const service=notes.service(),rows='failedSyncOperations' in service?await service.failedSyncOperations():[];if(current()){failedChanges.value=rows;failedChangesError.value=''}}catch{if(current())failedChangesError.value='未能读取本机未上传的更改，请重新检查'}finally{if(current())failedChangesLoading.value=false}
}
async function copyFailureDiagnostic(item:FailedSyncOperation){try{await navigator.clipboard.writeText(JSON.stringify(failedSyncDiagnostic(item,appInfo.version),null,2));message.value='脱敏诊断已复制，不包含正文或标题'}catch{message.value='复制失败，请记录错误代码和操作编号'}}
async function retryFailedChange(item:FailedSyncOperation){
 if(retryingChange.value||syncActivity.running||!connected.value||!syncEnabled.value||navigator.onLine===false)return
 const scope=archiveOwner(),revision=accountLifecycleRevision();retryingChange.value=item.operationId;changeFeedback.value[item.operationId]={state:'running',message:'正在确认并重试这条更改…'}
 try{const service=notes.service();if(!('retryFailedSyncOperation' in service))throw Error('当前空间不支持重试上传');await service.retryFailedSyncOperation(item.operationId);if(scope!==archiveOwner()||revision!==accountLifecycleRevision())return;await syncNow();if(scope===archiveOwner()&&revision===accountLifecycleRevision()){const remaining=failedChanges.value.find(value=>value.operationId===item.operationId);changeFeedback.value[item.operationId]={state:remaining?'failed':'succeeded',message:remaining?`仍需处理：${remaining.message}`:'本次重试已执行，请查看更新后的记录'}}}
 catch(source){if(scope===archiveOwner()&&revision===accountLifecycleRevision())changeFeedback.value[item.operationId]={state:'failed',message:failedChangesError.value=source instanceof Error?source.message:'重试失败，本机修改已保留'}}
 finally{if(scope===archiveOwner()&&revision===accountLifecycleRevision()){retryingChange.value='';await loadFailedChanges()}}
}
watch(()=>syncActivity.running,(running,previous)=>{if(!running&&previous&&activeTab.value==='sync')void loadFailedChanges()})
watch(syncScopeRevision,()=>{conflictBatchBusy.value=false;conflictBatchCompleted.value=0;conflictBatchTotal.value=0;conflictBatchMessage.value='';failedTasksGeneration++;taskConflictReadGeneration++;workspaceConflictReadGeneration++;retryingTask.value='';retryingChange.value='';taskConflicts.value=[];workspaceConflicts.value=[];folderConflicts.value=[];taskFeedback.value={};changeFeedback.value={};taskActionMessage.value='';taskCopyMessage.value='';message.value='';failedTasks.value=[];failedChangesGeneration++;failedChanges.value=[];failedChangesError.value='';if(activeTab.value==='sync')void loadTabData('sync')},{flush:'post'})
onBeforeUnmount(()=>{failedTasksGeneration++;failedChangesGeneration++})
let failedTasksGeneration=0
async function loadFailedTasks(){const generation=++failedTasksGeneration,scope=archiveOwner(),revision=accountLifecycleRevision(),rows=await tasksService.failedOperations();if(generation===failedTasksGeneration&&scope===archiveOwner()&&revision===accountLifecycleRevision())failedTasks.value=rows}
const syncInspectionBusy=ref(false)
const taskActionMessage=ref(''),taskCopyMessage=ref('')
const taskFeedback=ref<Record<string,SyncActionFeedback>>({}),changeFeedback=ref<Record<string,SyncActionFeedback>>({})
const changeIssueKind=(item:FailedSyncOperation)=>classifySyncIssue({status:item.status,sent:item.context.sent})||'unknown'
async function copyTaskFailure(task:Awaited<ReturnType<typeof tasksService.failedOperations>>[number]){try{await navigator.clipboard.writeText(JSON.stringify(taskFailureDiagnostic(task,appInfo.version),null,2));taskCopyMessage.value='任务脱敏诊断已复制，不含标题或任务内容'}catch{taskCopyMessage.value='复制失败，请记录页面上的错误提示'}}
async function discardFailedTask(task:Awaited<ReturnType<typeof tasksService.failedOperations>>[number]){
  const scope=archiveOwner(),revision=accountLifecycleRevision(),current=()=>scope===archiveOwner()&&revision===accountLifecycleRevision()
  if(retryingTask.value||!connected.value)return
  if(!await confirmDialog({title:`丢弃“${task.title}”的本机修改？`,message:'将放弃该任务尚未上传的修改，恢复服务器版本。服务器已无此任务时，本机记录也会移除。其他任务不受影响。',confirmText:'丢弃并采用服务器版本',tone:'danger'}))return
  if(retryingTask.value||!current())return
  taskCopyMessage.value='';taskFeedback.value[task.operationId]={state:'running',message:taskActionMessage.value='正在丢弃所选任务的本机修改…'}
  retryingTask.value=`discard:${task.operationId}`
  try{const changed=await tasksService.discardFailedOperation(task.operationId);if(!current())return;taskFeedback.value[task.operationId]={state:'succeeded',message:taskActionMessage.value=message.value=changed?`已丢弃“${task.title}”的本机修改，已完成本机记录处理`:'该失败操作已处理，请查看最新状态'}}
  catch(source){if(!current())return;taskFeedback.value[task.operationId]={state:'failed',message:taskActionMessage.value=message.value='丢弃失败：'+(source instanceof Error?source.message:typeof source==='string'&&source.trim()?source:'本机修改已保留')}}
  finally{if(current())try{await Promise.all([loadFailedTasks(),loadTaskConflicts()])}finally{if(current())retryingTask.value=''}}
}
async function retryFailedTask(operationId:string){
  const scope=archiveOwner(),revision=accountLifecycleRevision(),current=()=>scope===archiveOwner()&&revision===accountLifecycleRevision()
  if(retryingTask.value||!connected.value||!syncEnabled.value||navigator.onLine===false)return
  retryingTask.value=operationId;taskFeedback.value[operationId]={state:'running',message:'正在处理这条任务的重试…'}
  try{
   const preview=await tasksService.prepareFailedOperationRepair(operationId);if(!current())return
   if(preview){
    const [areaResult,projectResult]=await Promise.allSettled([workspaceService.areas(),workspaceService.projects(undefined,true)]);if(!current())return
    const areaName=(uid:string|null)=>uid?(areaResult.status==='fulfilled'?areaResult.value.find(value=>value.uid===uid)?.name:undefined)||`领域 ${uid.slice(0,8)}`:'未指定'
    const projectName=(uid:string|null)=>uid?(projectResult.status==='fulfilled'?projectResult.value.find(value=>value.uid===uid)?.name:undefined)||`项目 ${uid.slice(0,8)}`:'无项目'
    const scopeLabel=(scope:{areaUid:string|null;projectUid:string|null})=>`${areaName(scope.areaUid)} / ${projectName(scope.projectUid)}`
    const approved=await confirmDialog({title:'确认任务归属修复',message:`任务：${preview.title}；清单：${preview.listName}。修复前：${scopeLabel(preview.previous)}。修复后：${scopeLabel(preview.proposed)}。仅补齐所选清单的归属，保留任务正文和原始恢复档案。`,confirmText:'确认修复并重新提交',tone:'warning'})
    if(!current())return
    if(!approved){taskFeedback.value[operationId]={state:'succeeded',message:'已取消，任务和上传队列未修改'};return}
   }
   await tasksService.retryFailedOperation(operationId,preview);if(!current())return;await tasksService.sync();if(!current())return;taskFeedback.value[operationId]={state:'succeeded',message:taskActionMessage.value=message.value='本次重试已执行，请查看更新后的任务状态'}
  }
  catch(source){if(!current())return;taskFeedback.value[operationId]={state:'failed',message:taskActionMessage.value=message.value='重试未完成：'+(source instanceof Error?source.message:String(source||'本机修改已保留'))}}
  finally{if(current())try{await loadFailedTasks()}finally{if(current())retryingTask.value=''}}
}
let taskConflictReadGeneration=0,workspaceConflictReadGeneration=0
async function loadTaskConflicts(){const generation=++taskConflictReadGeneration,scope=archiveOwner(),revision=accountLifecycleRevision(),rows=await tasksService.conflicts();if(generation===taskConflictReadGeneration&&scope===archiveOwner()&&revision===accountLifecycleRevision())taskConflicts.value=rows}
const folderConflicts=ref<FolderConflict[]>([])
async function loadWorkspaceConflicts(){const generation=++workspaceConflictReadGeneration,scope=archiveOwner(),revision=accountLifecycleRevision(),[workspaces,folders]=await Promise.all([workspaceService.conflicts(),foldersService.conflicts()]);if(generation===workspaceConflictReadGeneration&&scope===archiveOwner()&&revision===accountLifecycleRevision()){workspaceConflicts.value=workspaces;folderConflicts.value=folders}}
const conflictBatchBusy=ref(false),conflictBatchCompleted=ref(0),conflictBatchTotal=ref(0),conflictBatchMessage=ref('')
const allConflicts=computed(()=>[
  ...folderConflicts.value.map(item=>({...item,confirmationStamp:syncConflictStamp(item),sourceId:item.conflictId,conflictId:`folder:${item.conflictId}`,kind:'目录',title:item.localEntity?.name||item.serverEntity?.name||'未命名目录',localDeleted:!!item.localEntity?.deleted,serverDeleted:!!item.serverEntity?.deleted})),
  ...notes.conflicts.map(item=>({...item,confirmationStamp:syncConflictStamp(item),sourceId:item.conflictId,conflictId:`note:${item.conflictId}`,kind:'笔记',title:item.localEntity?.title||item.serverEntity?.title||'未命名笔记',localDeleted:!!item.localEntity?.deleted||!!notes.trash.find(note=>note.uid===item.entityUid),serverDeleted:!!item.serverEntity?.deleted})),
  ...taskConflicts.value.map(item=>({...item,confirmationStamp:syncConflictStamp(item),sourceId:item.conflictId,conflictId:`task:${item.conflictId}`,kind:'任务',title:item.localEntity?.title||item.serverEntity?.title||'未命名任务',localDeleted:!!item.localEntity?.deleted,serverDeleted:!!item.serverEntity?.deleted})),
  ...workspaceConflicts.value.map(item=>({...item,confirmationStamp:syncConflictStamp(item),sourceId:item.conflictId,conflictId:`workspace:${item.conflictId}`,kind:'工作区',title:item.localEntity?.name||item.serverEntity?.name||'未命名工作区内容',localDeleted:!!item.localEntity?.deleted,serverDeleted:!!item.serverEntity?.deleted}))
])
async function resolveSelectedConflicts(ids:string[],strategy:'local'|'server'){
  if(conflictBatchBusy.value)return
  const selected=JSON.parse(JSON.stringify(allConflicts.value.filter(item=>ids.includes(item.conflictId)))) as typeof allConflicts.value
  if(!selected.length)return
  const scope=archiveOwner(),revision=accountLifecycleRevision(),current=()=>scope===archiveOwner()&&revision===accountLifecycleRevision()
  const check=()=>{if(!current())throw Error('账号或空间已切换，已停止处理旧批次')}
  conflictBatchBusy.value=true
  let resume:(()=>void)|undefined,completed=false
  try{
    const approved=await confirmDialog({title:`${strategy==='local'?'保留本机':'采用服务器版'} ${selected.length} 项冲突？`,message:strategy==='local'?'将按本机版本重新同步，包含本机的删除状态。服务器仍有变化时可能再次产生冲突。':'将用服务器版本替换这些本机修改，笔记原数据会先保留在本机恢复档案中。',confirmText:'确认处理',tone:'danger'})
    check();if(!approved)return
    conflictBatchCompleted.value=0;conflictBatchTotal.value=selected.length;conflictBatchMessage.value=''
    resume=await pausePcSync();check();const service=notes.service()
    const result=await syncQueueInspectionService.resolveBatch(auth.user?.userId?.toString()||'local',selected,strategy,async item=>{
      check()
      if(item.kind==='目录')await foldersService.resolveConflict(item.sourceId,strategy,item.confirmationStamp)
      else if(item.kind==='笔记')await service.resolveConflict(item.sourceId,strategy,item.confirmationStamp)
      else if(item.kind==='任务')await tasksService.resolveConflict(item.sourceId,strategy,item.confirmationStamp)
      else await workspaceService.resolveConflict(item.sourceId,strategy,item.confirmationStamp)
      check()
    },(done,total)=>{if(current()){conflictBatchCompleted.value=done;conflictBatchTotal.value=total}},check)
    check();completed=true
    conflictBatchMessage.value=`已处理 ${result.succeeded.length} 项，${result.failed.length} 项未完成${result.failed.length?'：'+result.failed.map(item=>item.reason).join('；'):''}`
    await Promise.all([notes.reloadLocal(),notes.loadConflicts(),loadTaskConflicts(),loadWorkspaceConflicts()])
  }catch(error){if(current())conflictBatchMessage.value=error instanceof Error?error.message:'冲突处理失败，请重试'}
  finally{resume?.();if(current()){conflictBatchBusy.value=false;window.dispatchEvent(new Event('note-flow:workspace-change'))}}
  if(completed&&current()&&strategy==='local')await syncNow()
}
async function resolveTaskConflict(conflictId:string,strategy:'local'|'server'){await tasksService.resolveConflict(conflictId,strategy);await loadTaskConflicts()}
async function resolveWorkspaceConflict(conflictId:string,strategy:'local'|'server'){await workspaceService.resolveConflict(conflictId,strategy);await loadWorkspaceConflicts()}
async function runSyncStage(label:string,action:()=>Promise<unknown>){
  message.value=`正在同步${label}…`
  try{await trackSync(`同步${label}`,action)}catch(source){
    const detail=source instanceof Error?source.message:String(source||'未知错误')
    throw new Error(`${label}同步失败：${detail}`)
  }
}
async function runResetSyncStage(label:string,action:()=>Promise<unknown>){
  dataMessage.value=`本机已清理，正在重新初始化${label}…`
  let timer:number|undefined
  try{
    await Promise.race([
      action(),
      new Promise<never>((_,reject)=>{timer=window.setTimeout(()=>reject(new Error(`${label}初始化超过 3 分钟，请检查服务器连接后重试同步`)),180_000)})
    ])
  }finally{if(timer!==undefined)window.clearTimeout(timer)}
}
async function syncNow() {
  if(!connected.value){message.value='当前为仅本机空间';return}
  if(!syncEnabled.value){message.value='自动同步已关闭，本机更改会保留，开启后可上传';return}
  if(navigator.onLine===false){message.value='当前离线，本机更改会保留，联网后可继续同步';return}
  const scope=archiveOwner(),revision=accountLifecycleRevision(),current=()=>scope===archiveOwner()&&revision===accountLifecycleRevision()
  const syncStage=async(label:string,action:()=>Promise<unknown>)=>{if(!current())throw Error('账号或空间已切换');await runSyncStage(label,action);if(!current())throw Error('账号或空间已切换')}
  try{
    // All repositories share one SQLite connection and common outbox/metadata tables.
    // Keep their transactions serialized; overlapping plugin-sql transactions can
    // surface as an opaque "argument type mismatch" from the native bridge.
    await syncStage('笔记',()=>notes.runSync())
    if(notes.syncPhase==='error')throw new Error(`笔记同步失败：${notes.syncError||'同步引擎未完成'}`)
    await syncStage('任务',()=>tasksService.sync())
    await syncStage('工作区',()=>workspaceService.sync())
    await syncStage('任务与笔记关联',()=>syncTaskNoteQueue())
    await syncStage('知识',()=>syncKnowledgeQueue())
    await syncStage('附件删除状态',()=>reconcileDeletedAttachments())
    await syncStage('画布',()=>createCanvasService(String(auth.user?.userId||'local')).sync())
    await Promise.all([loadTaskConflicts(),loadWorkspaceConflicts()])
    const queues=await syncQueueInspectionService.read(String(auth.user?.userId||'local')),remaining=queues?[queues.counts,...(queues.sources||[]).map(source=>source.counts)].reduce((sum,row)=>sum+Object.values(row).reduce((total,count)=>total+count,0),0):0
    if(!current())return
    if(remaining){message.value=`本次同步已执行，已检查队列仍有 ${remaining} 项待上传、确认或处理`;return}
    message.value=notes.syncPhase==='idle'&&!taskConflicts.value.length&&!workspaceConflicts.value.length?'同步完成':'同步完成，但仍有待处理冲突'
  }catch(source){if(current())message.value=source instanceof Error?source.message:'同步未完成，请检查网络'}finally{if(current())await Promise.allSettled([loadFailedTasks(),loadFailedChanges()])}
}
function connectServer(){if(isCommunityEdition){message.value='社区版使用本地空间，私有同步服务不可用';return}router.push({path:'/login',query:{connect:'1',redirect:'/settings'}})}
async function logout() { if(accountEditor.value && !await accountEditor.value.requestLeave())return;await auth.logout();syncEnabled.value=false;localStorage.setItem('note-flow-pc-sync-enabled','false');message.value='已断开服务器，本机数据仍可继续使用' }
async function exportData() { dataBusy.value=true;dataMessage.value='';try{if(isCommunityEdition||isDesktopClient()){const backup=await createLocalBackup();const saved:unknown=await downloadLocalBackup(backup);if(saved===false){dataMessage.value='已取消导出，本地数据保持不变';return}if(backup.sourceRestoreIncomplete){dataMessage.value='已导出中断恢复现场快照；这不是完整备份，不能替代原备份文件。请保留原备份继续恢复。';return}}else{const host=createBrowserPersonalBackup();try{await flushLocalDrafts();await notes.flushPendingSaves();host.assertCurrent();dataMessage.value='正在收集云端、本机修改和附件原文件…';const backup=await host.capture();host.assertCurrent();const saved=await saveLocalExport(new Blob([JSON.stringify(backup)],{type:'application/json'}),`jiyu-backup-${new Date().toISOString().slice(0,10)}.json`);if(!saved){dataMessage.value='已取消导出，本地数据保持不变';return}}finally{host.dispose()}}lastPersonalBackup.value=new Date().toISOString();try{localStorage.setItem(`note-flow-last-personal-backup:${archiveOwner()}`,lastPersonalBackup.value)}catch{/* 导出已完成，不因记录失败而误报 */}dataMessage.value='个人备份已导出，请妥善保存文件'}catch(source){dataMessage.value=source instanceof Error?source.message:'导出失败'}finally{dataBusy.value=false}}
const tickTickSaved=ref<Array<{uid:string;version:number;updatedAt?:string}>>([])
const localArchiveMode=isCommunityEdition||isDesktopClient()
const localArchivePlan=ref<LocalVaultPlan|null>(null)
function archiveOwner(){return currentProfile()?.storageKey||String(auth.user?.userId||'local')}
async function localArchiveSnapshot():Promise<LocalArchiveSnapshot>{
 const scope=archiveOwner(),service=notes.service(),values=[...await service.list('active'),...await service.list('archived')],tasks=await tasksService.list(),items=await localAiAttachmentItems(String(auth.user?.userId||'local')),recordings=await localRecordingsService.list()
 if(scope!==archiveOwner())throw Error('本地空间已切换，请重试')
 return {profileKey:scope,imports:JSON.parse(localStorage.getItem(`note-flow-vault-imports:${scope}`)||'{}'),notes:values,tasks,media:[...items.map(item=>({uid:item.uid,name:item.originalFilename,noteUid:item.noteUid,taskUid:item.taskUid,sha256:item.sha256,aliases:[item.contentUrl||''],read:()=>readLocalAiAttachment(String(auth.user?.userId||'local'),item)})),...recordings.map(item=>({uid:item.uid,name:item.name,noteUid:item.noteUid||undefined,sha256:item.sha256,read:()=>localRecordingsService.content(item)}))]}
}
const vaultWriterScope=archiveOwner(),vaultLedgerKey=`note-flow-vault-pending:${vaultWriterScope}`
const localVaultWriter=createLocalVaultWriter({createNote:value=>notes.service().create(value),updateNote:value=>notes.service().update(value),removeNote:value=>notes.service().remove(value),createTask:value=>tasksService.create(value),updateTask:value=>tasksService.update(value),removeTask:value=>tasksService.remove(value),attachTask:(uid,file)=>queueTaskAttachment(String(auth.user?.userId||'local'),uid,file),attach:(uid,file)=>queueAttachment(String(auth.user?.userId||'local'),uid,file),removeAttachment:uid=>removeLocalAttachment(String(auth.user?.userId||'local'),uid)},{isCurrent:()=>archiveOwner()===vaultWriterScope,load:()=>{try{return JSON.parse(localStorage.getItem(vaultLedgerKey)||'[]') as Applied[]}catch{return[]}},save:value=>localStorage.setItem(vaultLedgerKey,JSON.stringify(value)),recordImport:(key,value)=>{const storage=`note-flow-vault-imports:${vaultWriterScope}`,imports=JSON.parse(localStorage.getItem(storage)||'{}');if(value)imports[key]=value;else delete imports[key];localStorage.setItem(storage,JSON.stringify(imports))}})
async function exportVault(portable=false){dataBusy.value=true;dataMessage.value='正在打包…';try{
 let blob:Blob
 if(localArchiveMode){const snapshot=await localArchiveSnapshot();blob=await buildLocalVault(snapshot,portable||includeObsidianTasks.value,portable);if(snapshot.profileKey!==archiveOwner())throw Error('本地空间已切换，已取消导出')}
 else{const response=await api.get<Blob>(portable?'/api/v1/exports/portable-archive':'/api/v1/exports/obsidian',{params:portable?{}:{includeTasks:includeObsidianTasks.value},responseType:'blob'});blob=await validateExportArchive(response.data)}
 const saved=await saveLocalExport(blob,`jiyu-${portable?'portable':'obsidian'}-${new Date().toISOString().slice(0,10)}.zip`);dataMessage.value=saved?(localArchiveMode?'本地归档已导出，包含未同步内容；外链图片保留原链接，不会联网下载':'Obsidian Vault 已导出'):'已取消导出，本地数据保持不变'
 }catch(source){dataMessage.value=source instanceof Error?source.message:'归档导出失败'}finally{dataBusy.value=false}}
const exportObsidian=()=>exportVault(false),exportPortableArchive=()=>exportVault(true)
async function previewObsidianArchive(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];obsidianArchivePreview.value=null;obsidianArchiveFile.value=file||null;localArchivePlan.value=null;if(!file)return;obsidianBusy.value=true;obsidianMessage.value='正在预检 Obsidian ZIP…';try{if(localArchiveMode){const plan=await previewLocalVault(file,await localArchiveSnapshot());localArchivePlan.value=plan;obsidianArchivePreview.value={...plan,items:plan.items.map(item=>({...item,entity:item.entityType,message:''}))};obsidianMessage.value='本地预检完成，请确认变更分类';return}const form=new FormData();form.append('file',file);const response=await api.post<{data:ArchivePreview}>('/api/v1/imports/obsidian-archive/preview',form);obsidianArchivePreview.value=response.data.data;obsidianMessage.value='预检完成，请确认变更分类'}catch(source){obsidianMessage.value=source instanceof Error?source.message:'ZIP 预检失败';obsidianArchiveFile.value=null}finally{obsidianBusy.value=false;input.value=''}}
async function executeObsidianArchive(){const file=obsidianArchiveFile.value,preview=obsidianArchivePreview.value;if(!file||!preview||!await confirmDialog({title:'确认回导 Obsidian 归档？',message:`将创建 ${preview.counts.create||0} 项、更新 ${preview.counts.update||0} 项，并生成 ${preview.counts.conflict||0} 个冲突副本。`,confirmText:'开始回导'}))return;obsidianBusy.value=true;obsidianMessage.value='正在安全回导…';try{if(localArchiveMode){const plan=await previewLocalVault(file,await localArchiveSnapshot());if(plan.archiveDigest!==preview.archiveDigest||JSON.stringify(plan.items.map(item=>[item.uid,item.action]))!==JSON.stringify(localArchivePlan.value?.items.map(item=>[item.uid,item.action])))throw Error('文件或本地数据已变化，请重新预检');const result=await localVaultWriter.execute(plan);if(localVaultWriter.hasChanges())obsidianArchivePreview.value={...preview,batchUid:'local-vault'};await notes.load();obsidianMessage.value=`本地回导：成功 ${result.success}，失败 ${result.failed}。${result.errors.join('；')}`;return}const form=new FormData();form.append('file',file);const response=await api.post<{data:ArchivePreview}>('/api/v1/imports/obsidian-archive/execute',form,{params:{archiveDigest:preview.archiveDigest}});obsidianArchivePreview.value=response.data.data;await notes.load();obsidianMessage.value='Obsidian ZIP 回导完成'}catch(source){obsidianMessage.value=source instanceof Error?source.message:'ZIP 回导失败'}finally{obsidianBusy.value=false}}
async function rollbackObsidianArchive(){const preview=obsidianArchivePreview.value||(localArchiveMode&&localVaultWriter.hasChanges()?{batchUid:'local-vault',archiveDigest:'',total:0,counts:{},items:[]}:null);if(!preview?.batchUid||!await confirmDialog({title:'回滚本次回导？',message:'仅当本批次写入的数据之后没有再修改时才能回滚。',tone:'warning',confirmText:'确认回滚'}))return;obsidianBusy.value=true;try{if(localArchiveMode)await localVaultWriter.rollback(await localArchiveSnapshot());else await api.post(`/api/v1/imports/obsidian-archive/batches/${preview.batchUid}/rollback`);await notes.load();obsidianMessage.value='本次 Obsidian ZIP 回导已安全回滚';obsidianArchivePreview.value=null;obsidianArchiveFile.value=null}catch(source){obsidianMessage.value=source instanceof Error?source.message:'回滚失败'}finally{obsidianBusy.value=false}}
async function importData(event:Event){
 const input=event.target as HTMLInputElement,file=input.files?.[0]
 if(!file||dataBusy.value)return
 dataBusy.value=true;dataMessage.value='正在检查备份文件…'
 let assertLock=()=>{}
 const owner=archiveOwner(),revision=accountLifecycleRevision(),assertOwner=()=>{assertLock();if(owner!==archiveOwner()||revision!==accountLifecycleRevision())throw Error('账号或空间已切换，已取消恢复')}
 try{
  if(!localArchiveMode)assertLock=captureFileExportBoundary()
  const rawPayload=JSON.parse(await file.text());const payload=isCommunityEdition&&rawPayload?.kind?decodePortableValue(rawPayload) as any:rawPayload;assertOwner();let integritySummary='',browserEncryptedSpaces=0
  if(isCommunityEdition&&payload?.schema==='note-flow-community-backup')integritySummary=`预检：本地记录 ${payload.workspace?.entities?.length||0}、学习讨论 ${payload.learning?.sessions?.length||0}、通知 ${payload.notifications?.length||0}、历史版本 ${payload.review?.history?.revisions?.length||0}、整合稿 ${payload.review?.consolidation?.drafts?.length||0}、未完成日志 ${payload.review?.logs?.captures?.length||0}。`+(payload.workspaceKeys?.records?.length?`包含 ${payload.workspaceKeys.records.length} 个加密空间，恢复前将在本机验证口令或恢复码。`:'')
  if(!localArchiveMode&&payload?.schema==='note-flow-browser-backup'){const host=createBrowserPersonalBackup();try{const preview=await host.inspect(payload);assertOwner();browserEncryptedSpaces=preview.encryptedSpaces;integritySummary=`预检：云端笔记 ${preview.cloudNotes}、本机笔记记录 ${preview.localNotes}、云端任务 ${preview.tasks}、原始附件 ${preview.files}、恢复档案 ${preview.archives}。附件大小和 SHA256 校验通过。未同步修改恢复为新副本，旧同步操作仅归档。周期冲突时，日记保留为普通笔记副本。清单归属冲突时，保留当前清单并按备份归属恢复副本。`+(preview.unavailableRefs?`有 ${preview.unavailableRefs} 条来源或用途指向已删除或不在备份中的内容，仅保留记录信息。`:'')+(preview.encryptedSpaces?`包含 ${preview.encryptedSpaces} 个加密空间，恢复前将在本机验证口令或恢复码。`:'')}finally{host.dispose()}}
  if(!isCommunityEdition&&isDesktopClient()&&payload?.schema==='jiyu-local-workspace'){
   const media=await prepareBackupMedia(payload.media||[]);assertOwner()
   const count=(name:string)=>Array.isArray(payload.tables?.[name])?payload.tables[name].length:0
   integritySummary=(payload.workspaceKeys?.records?.length?`包含 ${payload.workspaceKeys.records.length} 个加密空间密钥档案，恢复前将在本机验证口令或恢复码。`:'')+(payload.sourceRestoreIncomplete?'此文件来自尚未完成的恢复现场，可能缺少原备份中的内容；只能合并文件实际包含的数据，不能替代原备份完成中断恢复。':'')+`预检：笔记 ${count('notes')}、任务 ${count('tasks')}、附件记录 ${count('local_attachments')}、录音 ${count('recordings')}、整合稿 ${Array.isArray(payload.consolidationDrafts?.drafts)?payload.consolidationDrafts.drafts.length:0}、未完成日志 ${Array.isArray(payload.logCaptures?.captures)?payload.logCaptures.captures.length:0}、媒体文件 ${media.length}。`+(media.some(item=>!item.source.sha256)?'旧备份部分媒体未提供原始校验值，无法确认导出后是否被改动。':'媒体大小和 SHA256 校验通过。')+(payload.logCaptures?.captures?.length?'未完成日志仅恢复本机缺失项，不自动写入；请在日志页继续恢复。':'')+(payload.consolidationDrafts?.drafts?.length?'整合稿仅恢复本机缺失项，不自动提交；可在整合记录中查看。':'')
  }
  const confirmed=await confirmDialog({title:'从文件恢复备份？',message:integritySummary+`文件：${file.name}（${Math.max(1,Math.round(file.size/1024))} KB）。恢复不会将当前空间整体回退到备份时刻。`+(isCommunityEdition?'备份将恢复到独立新空间，原空间保持保留。保险箱密文按原归属保留在档案中，不会改写密文或主密码。':localArchiveMode?'仅恢复本机缺失内容，已有内容保留；旧同步队列归档而不自动重放。':'备份数据将合并到当前账号。'),confirmText:'确认恢复'})
  if(!confirmed){dataMessage.value='已取消恢复';return}
  assertOwner();await flushLocalDrafts();await notes.flushPendingSaves();assertOwner();dataMessage.value='正在恢复备份，请保持应用打开…'
  let unlockIndex=0
  if(isCommunityEdition||isDesktopClient())await restoreLocalBackup(payload,{confirmDamagedRestore:()=>confirmRestoreRepair(assertOwner),workspaceCredentials:async()=>{
   assertOwner();const secret=await promptDialog({title:`解锁加密备份（${++unlockIndex}/${payload.workspaceKeys?.records?.length||1}）`,message:'请输入加密口令或恢复码，仅在本机验证。取消后不会开始写入恢复数据。',inputLabel:'口令或恢复码',inputType:'password',inputRequired:true,confirmText:'验证并继续'})
   assertOwner();if(secret===null)throw Error('已取消加密备份恢复');return{secret,kind:'auto'}
  }})
  else if(payload?.schema==='note-flow-browser-backup'){const host=createBrowserPersonalBackup(async()=>{assertOwner();const secret=await promptDialog({title:`解锁加密备份（${++unlockIndex}/${browserEncryptedSpaces}）`,message:'请输入加密口令或恢复码，仅在本机验证。取消后不会开始写入恢复数据。',inputLabel:'口令或恢复码',inputType:'password',inputRequired:true,confirmText:'验证并继续'});assertOwner();if(secret===null)throw Error('已取消加密备份恢复');return{secret,kind:'auto'}});try{await host.restore(payload)}finally{host.dispose()}}
  else{if(!payload||typeof payload!=='object'||typeof payload.schemaVersion!=='number')throw Error('不是有效的迹语可迁移数据文件');await api.post('/api/v1/imports/portable',payload)}
  if(isCommunityEdition){await auth.fetchUser();notes.$reset();window.dispatchEvent(new Event('note-flow:workspace-change'))}else assertOwner()
  await notes.reloadLocal()
  if(payload?.sourceRestoreIncomplete){dataMessage.value='现场快照中包含的缺失数据已合并；这不代表原备份已完整恢复，请保留原备份文件。';return}
  dataMessage.value=isCommunityEdition?'备份已恢复到新空间，原空间保留；保险箱原密文保留在完整档案中。':localArchiveMode?'缺失内容已恢复，已有内容保留；旧同步操作已归档。':'导入完成，笔记数据已刷新'
 }catch(source){dataMessage.value=source instanceof Error?source.message:'导入失败'}finally{dataBusy.value=false;input.value=''}
}
const useServerTickTick=()=>!localArchiveMode
const canInspectTickTickScopes=()=>!isCommunityEdition&&syncAvailable()
async function previewTickTick(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];tickTickScopeInspection.value=null;tickTickScopeSession=undefined;tickTickPreview.value=null;tickTickResult.value=null;tickTickBatchUid.value='';localTickTickUids.value=[];tickTickFile.value=file||null;if(!file)return;tickTickBusy.value=true;tickTickMessage.value='正在预检滴答清单 CSV…';try{if(!useServerTickTick()){const parsed=parseLocalTickTick(await file.text()),rows=parsed.tasks,digest=await blobDigest(file);tickTickPreview.value={digest,total:rows.length,lists:new Set(rows.map(value=>value.task.listName).filter(Boolean)).size,tags:new Set(rows.flatMap(value=>value.tags)).size,completed:rows.filter(value=>value.task.completed&&!value.task.abandonedAt).length,abandoned:rows.filter(value=>value.task.abandonedAt).length,dated:rows.filter(value=>value.task.dueAt||value.task.startAt).length,recurring:rows.filter(value=>value.task.recurrenceRule).length,warnings:['直接写入本地空间，无需服务器；相同 CSV 的已导入行会跳过',...parsed.warnings]}}else{const form=new FormData();form.append('file',file);const response=await api.post<{data:TickTickPreview}>('/api/v1/imports/ticktick/preview',form);tickTickPreview.value=response.data.data}tickTickMessage.value='预检完成，请确认后导入'}catch(source){tickTickMessage.value=source instanceof Error?source.message:'CSV 预检失败';tickTickFile.value=null}finally{tickTickBusy.value=false;input.value=''}}
async function inspectTickTickScopes(){
 const file=tickTickFile.value,digest=tickTickPreview.value?.digest;if(!file||!digest||!canInspectTickTickScopes())return
 tickTickBusy.value=true;tickTickMessage.value='正在检查旧任务归属…';tickTickScopeInspection.value=null
 try{const boundary=captureFileExportBoundary(),revision=accountLifecycleRevision(),assertCurrent=()=>{boundary();if(file!==tickTickFile.value||digest!==tickTickPreview.value?.digest||revision!==accountLifecycleRevision())throw Error('文件、账号或空间已变化，请重新检查')};tickTickScopeSession=createTickTickScopeRepair(file,digest,assertCurrent);tickTickScopeInspection.value=await tickTickScopeSession.inspect();tickTickMessage.value='检查完成，尚未修改任务'}catch(error){tickTickScopeSession=undefined;tickTickMessage.value=error instanceof Error?error.message:'检查失败'}finally{tickTickBusy.value=false}
}
async function applyTickTickScopes(){
 const session=tickTickScopeSession,inspection=tickTickScopeInspection.value;if(!session||!inspection?.repairs.length)return
 if(!await confirmDialog({title:'修复旧任务归属',message:`将修复 ${inspection.repairs.length} 个旧任务的领域和项目归属。标题和正文保持不变，已修改的任务不会覆盖。`,confirmText:'确认修复',cancelText:'取消'}))return
 if(session!==tickTickScopeSession)return;tickTickBusy.value=true
 try{const result=await session.apply();tickTickMessage.value=`已修复 ${result.repaired} 项，已一致跳过 ${result.skipped} 项`;tickTickScopeInspection.value=null;tickTickScopeSession=undefined;if(isDesktopClient())await tasksService.sync()}catch(error){tickTickMessage.value=error instanceof Error?error.message:'修复未完成，请重新检查'}finally{tickTickBusy.value=false}
}
async function executeTickTick(){const file=tickTickFile.value,preview=tickTickPreview.value;if(!file||!preview||!await confirmDialog(`将导入 ${preview.total} 个任务。继续吗？`))return;tickTickBusy.value=true;tickTickMessage.value='正在导入任务…';try{if(!useServerTickTick()){tickTickSaved.value=[];const errors:string[]=[],uids:string[]=[],parsed=parseLocalTickTick(await file.text()),scope=archiveOwner(),ledgerKey=`note-flow-ticktick-local:${scope}:${preview.digest}`,existing=await tasksService.list(),ledger:Record<string,string>=Object.assign(Object.create(null),JSON.parse(localStorage.getItem(ledgerKey)||'{}')),allTags=await tagsService.list();let skipped=0;const pending=[...parsed.tasks]
while(pending.length){const index=pending.findIndex(row=>!row.parentSourceId||ledger[row.parentSourceId]||!pending.some(other=>other.sourceId===row.parentSourceId)),row=pending.splice(index<0?0:index,1)[0];if(scope!==archiveOwner())throw Error('本地空间已切换');if(ledger[row.sourceId]&&existing.some(task=>task.uid===ledger[row.sourceId])){skipped++;continue}try{const tagIds:number[]=[];for(const name of row.tags){let tag=allTags.find(tag=>tag.name===name);if(!tag){tag=await tagsService.create(name);allTags.push(tag)}tagIds.push(tag.id)}const task=await tasksService.create({...row.task,tagIds,parentTaskUid:ledger[row.parentSourceId]||null});ledger[row.sourceId]=task.uid;existing.push(task);uids.push(task.uid);tickTickSaved.value.push({uid:task.uid,version:task.version,updatedAt:task.updatedAt});localStorage.setItem(ledgerKey,JSON.stringify(ledger))}catch(source){errors.push(source instanceof Error?source.message:`${row.task.title} 导入失败`)}}
localTickTickUids.value=uids;tickTickBatchUid.value=`local-${crypto.randomUUID()}`;tickTickResult.value={success:uids.length,skipped,failed:errors.length,errors}}else{const form=new FormData();form.append('file',file);const response=await api.post<{data:{batchUid:string;success:number;skipped:number;failed:number;errors:string[]}}>('/api/v1/imports/ticktick/execute',form,{params:{digest:preview.digest}});tickTickBatchUid.value=response.data.data.batchUid;tickTickResult.value=response.data.data;if(isDesktopClient())await tasksService.sync()}tickTickMessage.value=tickTickResult.value?.failed?'导入完成，但有部分任务失败':'滴答清单任务导入完成'}catch(source){tickTickMessage.value=source instanceof Error?source.message:'导入失败'}finally{tickTickBusy.value=false}}
async function rollbackTickTick(){if(!tickTickBatchUid.value||!await confirmDialog('将删除本批次导入的任务。继续吗？'))return;tickTickBusy.value=true;try{if(tickTickBatchUid.value.startsWith('local-')){const imported=new Set(localTickTickUids.value);const current=(await tasksService.list()).filter(item=>imported.has(item.uid));if(current.some(task=>{const saved=tickTickSaved.value.find(item=>item.uid===task.uid);return !saved||saved.version!==task.version||saved.updatedAt!==task.updatedAt}))throw Error('导入任务已修改，不能回滚；原任务保持不变');for(const task of current)await tasksService.remove(task);localTickTickUids.value=[]}else{await api.post(`/api/v1/imports/ticktick/batches/${tickTickBatchUid.value}/rollback`);if(isDesktopClient())await tasksService.sync()}tickTickMessage.value='本次滴答清单导入已回滚';tickTickBatchUid.value='';tickTickResult.value=null}catch(source){tickTickMessage.value=source instanceof Error?source.message:'回滚失败'}finally{tickTickBusy.value=false}}
async function selectObsidianVault(event: Event) {
  const input = event.target as HTMLInputElement
  obsidianMessage.value = ''; importResult.value = null; obsidianScan.value = null
  if (!input.files?.length) return
  obsidianBusy.value = true; obsidianProgress.value = '正在扫描 Vault…'
  try { const scan = await scanObsidianVault(input.files); if (!scan.items.length&&!scan.attachments.length) throw new Error('所选目录中没有可导入的文件'); await loadObsidianScopes();obsidianScan.value = scan; obsidianDialogOpen.value = true; obsidianMessage.value = '扫描完成，请确认导入设置' }
  catch (source) { obsidianMessage.value = source instanceof Error ? source.message : 'Vault 扫描失败' }
  finally { obsidianBusy.value = false; obsidianProgress.value = ''; input.value = '' }
}
async function startObsidianImport() {
  const scan = obsidianScan.value
  if (!scan) return
  if(obsidianProjectStrategy.value==='existing'&&!obsidianTargetProjectUid.value){obsidianMessage.value='请选择要导入到的目标项目';return}
  if(obsidianProjectStrategy.value==='top-level-folders'&&!obsidianTargetAreaUid.value){obsidianMessage.value='批量导入项目时，请先选择项目所属领域';return}
  obsidianBusy.value = true; obsidianMessage.value = ''; obsidianProgress.value = `准备导入 0 / ${scan.items.length}`
  try { const result = await importObsidianScan(scan, (done, total) => { obsidianProgress.value = `正在导入 ${done} / ${total}` },{remoteImages:remoteImagePolicy.value,organization:obsidianOrganization.value,projectStrategy:obsidianProjectStrategy.value,targetAreaUid:obsidianTargetAreaUid.value||null,targetProjectUid:obsidianProjectStrategy.value==='existing'?obsidianTargetProjectUid.value||null:null,importStandaloneFiles:obsidianImportStandaloneFiles.value}); importResult.value = { ...result, batchUids: result.batches.map(batch => batch.uid) }; obsidianFailureDetailsOpen.value = false; await notes.load();window.dispatchEvent(new Event('note-flow:workspace-change'));if(isDesktopClient())localImportSummary.value=await localObsidianImportSummary(); obsidianMessage.value = result.failed||result.attachmentFailed||result.remoteImageFailed||('taskFailed' in result&&result.taskFailed) ? '导入完成，但有部分项目失败' : 'Obsidian 笔记导入完成'; obsidianDialogOpen.value=false }
  catch (source) { obsidianMessage.value = `Obsidian 导入失败：${importErrorMessage(source)}` }
  finally { obsidianBusy.value = false; obsidianProgress.value = '' }
}
async function rollbackObsidianImport() {
  const result = importResult.value
  if (!result || !await confirmDialog('回滚会将本次新建且尚未修改的笔记移入回收站。继续吗？')) return
  obsidianBusy.value = true; obsidianMessage.value = '正在回滚…'
  try { if(isDesktopClient()){const service=notes.service(),all=await service.list();for(const record of result.records.filter(item=>item.result==='success'&&item.noteUid)){const note=all.find(item=>item.uid===record.noteUid);if(note)await service.remove(note)}}else for (const uid of [...result.batchUids].reverse()) await api.post(`/api/v1/imports/${uid}/rollback`); await notes.load(); obsidianMessage.value = '本次 Obsidian 导入已回滚'; importResult.value = null; obsidianScan.value = null }
  catch (source) { obsidianMessage.value = source instanceof Error ? source.message : '回滚失败' }
  finally { obsidianBusy.value = false }
}
async function retryFailedImport(){const scan=obsidianScan.value,current=importResult.value;if(!scan||!current)return;obsidianBusy.value=true;obsidianProgress.value='正在重试失败项目…';try{let next=current;const failedRecords=current.records.filter(item=>item.result==='failed');if(failedRecords.length){const result=await retryObsidianFailures(scan,failedRecords,(done,total)=>obsidianProgress.value=`正在重试笔记 ${done} / ${total}`);next={...result,batchUids:result.batches.map(batch=>batch.uid)}}const attachmentRetries=isDesktopClient()?[]:await retryObsidianAttachments(scan,current.attachmentRecords);if(attachmentRetries.length){const retried=new Set(attachmentRetries.map(item=>`${item.noteUid}:${item.sourcePath}`)),untouched=next.attachmentRecords.filter(item=>!retried.has(`${item.noteUid}:${item.sourcePath}`)),combined=[...untouched,...attachmentRetries];next={...next,attachmentRecords:combined,attachmentSuccess:combined.filter(item=>item.result==='success').length,attachmentFailed:combined.filter(item=>item.result==='failed').length}}importResult.value=next;await notes.load();obsidianMessage.value=next.failed||next.attachmentFailed?'重试完成，仍有失败项目':'失败项目已重试完成'}catch(source){obsidianMessage.value=source instanceof Error?source.message:'重试失败'}finally{obsidianBusy.value=false;obsidianProgress.value=''}}
async function clearObsidianImports(){if(!await confirmDialog(`将删除可识别的 ${localImportSummary.value.notes} 篇 Obsidian 导入笔记及其附件，其他笔记不受影响。继续吗？`))return;obsidianBusy.value=true;try{const count=await deleteLocalObsidianImports();await notes.load();localImportSummary.value=await localObsidianImportSummary();importResult.value=null;obsidianMessage.value=`已删除 ${count} 篇导入笔记，可以重新选择 Vault 导入`}catch(source){obsidianMessage.value=source instanceof Error?source.message:'清理失败'}finally{obsidianBusy.value=false}}
async function inspectLocalWorkspace(){
  dataBusy.value=true;dataMessage.value='正在检查本机数据…'
  try{resetPreview.value=await previewLocalWorkspaceReset();dataMessage.value='请根据检查结果选择处理冲突或丢弃并重建'}
  catch(source){dataMessage.value=source instanceof Error?source.message:'无法读取本机数据'}
  finally{dataBusy.value=false}
}
async function openLocalConflictResolution(){
  activeTab.value='sync';message.value='正在读取本机同步冲突…'
  await Promise.allSettled([notes.loadConflicts(),loadTaskConflicts(),loadWorkspaceConflicts()])
  const visible=notes.conflicts.length+taskConflicts.value.length+workspaceConflicts.value.length
  message.value=visible?`发现 ${visible} 条可处理冲突，可全选后批量采用服务器版或保留本机`:'没有可逐条处理的笔记、任务或工作区冲突；其他类型冲突可返回“数据与导入”直接丢弃并重建'
}
async function clearLocalWorkspace(){
  if(isCommunityEdition||!currentProfile()?.serverBinding||!connected.value||!online.value){dataMessage.value='纯本地或未连接空间不能从服务器重建，请使用备份恢复';return}
  try{await api.get('/api/v2/sync/epoch')}catch{dataMessage.value='无法确认服务器可恢复，未清除本机数据。请连接服务器后重试';return}
  if(!resetPreview.value)await inspectLocalWorkspace()
  if(!resetPreview.value)return
  resetPreview.value=await previewLocalWorkspaceReset()
  const preview=resetPreview.value,pending=(preview.pending+preview.failed+preview.conflicts)
  if(!await confirmDialog({title:preview.resetInProgress?'继续未完成的本机重建？':'重建当前账号的本机数据？',message:`将清除 ${preview.notes} 篇笔记、${preview.tasks} 个任务、${preview.attachments} 个附件和 ${preview.recordings} 条录音。${pending?`其中有 ${preview.pending} 条待同步、${preview.failed} 条失败和 ${preview.conflicts} 条冲突，清除后无法上传。`:''}账号、服务器地址、AI 配置和本地保险箱会保留。`,tone:'danger',confirmText:'继续'}))return
  const confirmation=pending?'丢弃本机更改':'重建本机数据'
  if((await promptDialog({title:'最终确认',message:pending?'检测到尚未同步或存在冲突的数据。确认丢弃后不可恢复，建议先导出备份。':'本机业务数据会被清除，并从服务器重新初始化。',inputLabel:`请输入“${confirmation}”`,confirmationText:confirmation,inputRequired:true,tone:'danger',confirmText:'确认重建'}))?.trim()!==confirmation){dataMessage.value='已取消重建';return}
  dataBusy.value=true;dataMessage.value='正在重置本地空间…'
  try{
    await beginPcSyncReset()
    if(!preview.noteJournal)throw Error('同步证据尚未准备完成，请重新检查')
    const result=await resetLocalWorkspace({discard:{...preview.noteJournal,kind:'user-confirmed-local-reset'}});notifications.clear();window.dispatchEvent(new CustomEvent('note-flow:account-data-reset',{detail:{localOnly:true}}));localImportSummary.value={notes:0,batches:0};importResult.value=null;obsidianScan.value=null
    endPcSyncReset()
    if(connected.value&&navigator.onLine!==false){
      await runResetSyncStage('笔记',()=>notes.runSync())
      await runResetSyncStage('任务',()=>tasksService.sync())
      await runResetSyncStage('工作区',()=>workspaceService.sync())
      await runResetSyncStage('画布',()=>createCanvasService(String(auth.user?.userId||'local')).sync())
      dataMessage.value=`本机重建完成：清理 ${result.notes} 篇笔记、${result.tasks} 个任务，并已从服务器重新初始化`
    }else dataMessage.value=`本机重建完成：清理 ${result.notes} 篇笔记、${result.tasks} 个任务；当前离线或未连接服务器，将在可同步后初始化`
    resetPreview.value=await previewLocalWorkspaceReset();await notes.load();window.dispatchEvent(new Event('note-flow:workspace-change'))
  }catch(source){const detail=source instanceof Error?source.message:'重新初始化未完成';dataMessage.value=`本机重建未完成：${detail}。请核对当前数据与恢复状态，可在“账号与同步”中点击“立即同步”继续。`;resetPreview.value=await previewLocalWorkspaceReset().catch(()=>resetPreview.value)}finally{endPcSyncReset();dataBusy.value=false}
}
async function openCloudReset(){
  if(isCommunityEdition){dataMessage.value='社区版没有云端账号数据，云端重置不可用';return}
  cloudResetOpen.value=true;cloudResetPreview.value=null;cloudResetBusy.value=true;cloudResetMessage.value='正在读取云端数据范围…';cloudResetPassword.value='';cloudResetConfirmation.value='';deleteAiCredentials.value=false;deleteCloudVault.value=false;createCloudResetBackup.value=true;cloudResetIdempotencyKey.value=localStorage.getItem(CLOUD_RESET_RECOVERY_KEY)||crypto.randomUUID();cloudResetChallengeToken.value=''
  try{if(localStorage.getItem(CLOUD_RESET_RECOVERY_KEY)){const recovered=await accountDataResetService.recover(cloudResetIdempotencyKey.value,message=>cloudResetMessage.value=message);await finishCloudReset(recovered);return}cloudResetPreview.value=await accountDataResetService.preview();cloudResetMessage.value=''}catch(source){cloudResetPreview.value=await accountDataResetService.preview().catch(()=>null);cloudResetMessage.value=source instanceof Error?source.message:cloudResetPreview.value?'':'无法读取云端数据'}finally{cloudResetBusy.value=false}
}
async function finishCloudReset(result:Awaited<ReturnType<typeof accountDataResetService.reset>>){
  // Recovery may run before the normal desktop bootstrap. The authenticated
  // user is enough to recreate the same server-bound local context.
  if(isDesktopClient())ensureDesktopProfile(auth.user)
  await beginPcSyncReset()
  try{
    if(isDesktopClient()){
      const observed=await previewLocalWorkspaceReset();if(!observed.noteJournal)throw Error('同步证据尚未准备完成，请重新检查')
      await resetLocalWorkspace({discard:{...observed.noteJournal,kind:'authenticated-server-reset',serverOperationId:result.operationId,nextEpoch:result.effectiveSyncEpoch}})
    }else await notes.resetBrowserCache()
    clearReadingProgress(String(auth.user?.userId||'anonymous'));acceptServerSyncEpoch(result.effectiveSyncEpoch);notifications.clear();window.dispatchEvent(new Event('note-flow:account-data-reset'))
    if(Object.prototype.hasOwnProperty.call(result.removed,'nf_vault_snapshot')){const ownerId=activeProfileId(auth.user?.userId||'');await clearVault(ownerId);clearVaultSyncState(ownerId);clearVaultSession()}
    await notes.load();window.dispatchEvent(new Event('note-flow:workspace-change'));localStorage.removeItem(CLOUD_RESET_RECOVERY_KEY);cloudResetPassword.value='';cloudResetConfirmation.value='';cloudResetChallengeToken.value='';cloudResetMessage.value=`云端数据已清理，操作编号 ${result.operationId.slice(0,8)}；其他设备联网后会自动重建本机数据。`
  }finally{endPcSyncReset()}
}
async function resetCloudAccount(){
  if(cloudResetBusy.value||!cloudResetPreview.value)return
  if(cloudResetConfirmation.value!=='RESET 我的数据'){cloudResetMessage.value='请输入完整确认短语';return}
  // Chromium/WebView password autofill can update the rendered input without
  // dispatching the input event that v-model relies on. Read the submitted DOM
  // value so the password the user can see is exactly the password we verify.
  const submittedPassword=cloudResetPasswordInput.value?.value??cloudResetPassword.value
  if(!cloudResetChallengeToken.value&&!submittedPassword){cloudResetMessage.value='请输入当前登录密码';return}
  cloudResetBusy.value=true;cloudResetMessage.value='正在验证密码…'
  try{
    const challengeToken=cloudResetChallengeToken.value||(await accountDataResetService.challenge(submittedPassword)).challengeToken
    cloudResetChallengeToken.value=challengeToken;cloudResetPassword.value=''
    cloudResetMessage.value=createCloudResetBackup.value?'正在创建重置前恢复点，成功后才会清理云端数据…':'正在清理云端数据（本次不创建恢复点）…'
    localStorage.setItem(CLOUD_RESET_RECOVERY_KEY,cloudResetIdempotencyKey.value)
    const result=await accountDataResetService.resetAndWait({challengeToken,confirmation:cloudResetConfirmation.value,deleteAiCredentials:deleteAiCredentials.value,deleteCloudVault:deleteCloudVault.value,createBackup:createCloudResetBackup.value},cloudResetIdempotencyKey.value,message=>cloudResetMessage.value=message)
    await finishCloudReset(result)
  }catch(source){const detail=source instanceof Error?source.message:'云端数据清理失败';cloudResetMessage.value=detail.includes('RESET_REAUTH_REQUIRED')?'当前登录密码不正确，请重新输入':detail.includes('RESET_RATE_LIMITED')?'重置验证尝试过于频繁，请稍后再试':detail.includes('DATA_PROTECTION_UNAVAILABLE')?'服务器备份环境不可用，为保护数据，本次重置已取消':detail.includes('DATA_PROTECTION_BUSY')?'服务器正在备份，请等待完成后再重置':detail.includes('DATA_PROTECTION_BACKUP_TIMEOUT')?'重置前备份超时，数据尚未删除，请检查服务器后重试':detail.includes('DATA_PROTECTION_BACKUP')?'重置前备份失败，数据尚未删除，请先修复备份':detail}finally{endPcSyncReset();cloudResetBusy.value=false}
}
async function chooseObsidianVault(){
  obsidianMessage.value='';importResult.value=null;obsidianScan.value=null;obsidianBusy.value=true;obsidianProgress.value='正在读取 Vault…'
  try{const entries=await invoke<Array<{relativePath:string;name:string;lastModified:number;bytes:number[]}>|null>('choose_obsidian_vault');if(!entries)return;const files=entries.map(entry=>{const file=new File([new Uint8Array(entry.bytes)],entry.name,{lastModified:entry.lastModified});Object.defineProperty(file,'webkitRelativePath',{value:entry.relativePath});return file});const scan=await scanObsidianVault(files);if(!scan.items.length&&!scan.attachments.length)throw new Error('所选目录中没有可导入的文件');await loadObsidianScopes();obsidianScan.value=scan;obsidianDialogOpen.value=true;obsidianMessage.value='扫描完成，请确认导入设置'}catch(source){obsidianMessage.value=source instanceof Error?source.message:'Vault 读取失败'}finally{obsidianBusy.value=false;obsidianProgress.value=''}
}
async function loadTabData(tab:SettingsTab){
  if(tab==='sync'){syncInspectionBusy.value=true;try{await Promise.allSettled([notes.loadConflicts(),loadTaskConflicts(),loadWorkspaceConflicts(),loadFailedTasks(),loadFailedChanges()])}finally{syncInspectionBusy.value=false}return}
  if(loadedTabs.has(tab))return
  loadedTabs.add(tab)
  if(tab==='ai'&&!isCommunityEdition&&selectedAiChannel.value==='server')await loadAiConfig()
  else if(tab==='data'&&isDesktopClient())localImportSummary.value=await localObsidianImportSummary().catch(()=>localImportSummary.value)
  else if(tab==='focus')try{const value=(isCommunityEdition||isDesktopClient())?await localFocusService.settings():(await api.get<{data:typeof focusSettings.value}>('/focus/settings')).data.data;focusSettings.value={...focusSettings.value,...value}}catch{focusMessage.value='无法读取设置，当前显示默认值；保存后才能生效'}
}
watch(activeTab,tab=>{void loadTabData(tab)})
onBeforeUnmount(()=>{window.removeEventListener('note-flow:account-lifecycle-change',refreshSyncScope);window.removeEventListener('online',updateOnline);window.removeEventListener('offline',updateOnline)})
watch(()=>[activeTab.value,profile.value?.storageKey],()=>{if(activeTab.value==='protection')void loadStorageLocation()})
onMounted(() => { window.addEventListener('note-flow:account-lifecycle-change',refreshSyncScope);window.addEventListener('online',updateOnline);window.addEventListener('offline',updateOnline);void loadStorageLocation();document.documentElement.style.setProperty('--pc-primary', accent.value);void loadTabData(activeTab.value) })
</script>

<template>
  <div class="settings-page-v3">
    <aside class="settings-nav"><button class="settings-back" type="button" @click="returnToWorkspace"><span>←</span>返回工作区</button><header><span>⚙</span><div><strong>设置中心</strong><small>个性化配置与数据管理</small></div></header><nav><section v-for="group in settingsGroups" :key="group.label" class="settings-nav-group"><h2>{{group.label}}</h2><button v-for="tab in group.tabs" :key="tab.key" :class="{active:activeTab===tab.key}" @click="selectSettingsTab(tab.key)"><i><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tab.icon"/></svg></i>{{tab.label}}</button><button v-if="group.key==='data'" :class="{active:activeTab==='protection'}" @click="selectSettingsTab('protection')"><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6"/></svg></i>备份恢复</button><button v-if="group.key==='app' && canManageUsers" :class="{active:activeTab==='users'}" @click="selectSettingsTab('users')"><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></i>用户管理</button></section></nav></aside>
    <main class="settings-content">
      <template v-if="activeTab==='protection'">
        <header class="settings-content-head"><h1>备份恢复</h1><p>保存个人备份，或从已有文件恢复内容。</p></header>
        <LocalRestoreNotice v-if="!isCommunityEdition" :show-action="false"/><section class="setting-group"><h2>个人备份</h2><div class="setting-row"><span><b>导出个人备份</b><small>{{localArchiveMode?(isCommunityEdition?'保存本地数据、附件和保险箱原密文':'保存本地数据、附件、AI 讨论与知识；保险箱请单独备份'):'保存云端数据、本机未同步修改和附件原文件；保险箱请单独备份'}}</small></span><button :disabled="dataBusy" @click="exportData">导出 JSON</button></div><div class="setting-row"><span><b>从文件恢复</b><small>{{(isCommunityEdition?'恢复到独立新空间，保留原空间与原保险箱密文':(localArchiveMode?'仅恢复缺失内容，保留已有内容；旧同步操作单独归档':'将备份内容合并到当前账号'))}}</small></span><label class="setting-file">选择文件<input type="file" accept="application/json,.json" :disabled="dataBusy" @change="importData"/></label></div><p class="backup-hint">{{lastPersonalBackup?`本机最近导出：${new Date(lastPersonalBackup).toLocaleString()}（请确认文件已保存）`:'本机尚无个人备份导出记录'}}</p></section><p v-if="dataMessage" role="status">{{dataMessage}}</p>
        <div v-if="localArchiveMode&&!isCommunityEdition" class="setting-row"><span><b>保险箱备份</b><small>使用独立加密备份，与上方个人备份分别保存</small></span><button @click="router.push('/vault')">前往保险箱</button></div>
        <details class="setting-group backup-details"><summary>存储位置</summary><div class="setting-row"><span><b>{{isDesktopClient()?'当前空间数据库':'浏览器存储'}}</b><small class="storage-path">{{localStorageLocation}}</small></span><button v-if="isDesktopClient()" @click="copyStorageLocation">复制位置</button></div><template v-if="isDesktopClient()"><div class="setting-row"><span><b>附件与录音目录</b><small class="storage-path">{{localMediaRoot}}</small></span></div><details class="backup-instructions"><summary>如何手动备份文件</summary><p>先退出客户端，再复制数据库目录内的数据库及 WAL 文件，并完整复制附件与录音目录。仅复制数据库文件不能保存所有图片与附件。</p><p class="storage-path">数据库目录：{{localStorageRoot}}</p></details></template><p v-else class="backup-hint">浏览器没有可直接复制的数据库文件，请使用上方 JSON 导出。清理站点数据会删除本地内容。</p><p v-if="storageMessage" role="status">{{storageMessage}}</p></details>
        <details v-if="canManageUsers" class="setting-group backup-details"><summary>服务器备份<span>管理员 · 保护整个服务器</span></summary><DataProtectionView v-if="connected&&online" embedded /><p v-else class="backup-hint">连接服务器后可管理恢复点，个人备份不受影响。</p></details>
      </template>
      <template v-else-if="!isCommunityEdition&&activeTab==='account'">
        <header class="settings-content-head"><h1>账号设置</h1><p>管理头像、昵称和联系方式。</p></header>
        <AccountSettings v-if="connected" key="profile" ref="accountEditor" section="profile" />
        <section v-else class="setting-group"><h2>本地账号</h2><p>当前资料保存在本机。连接服务器并登录后，可编辑个人资料和账号安全设置。</p><button @click="selectSettingsTab('sync')">前往同步设置</button></section>

      </template>
      <template v-else-if="activeTab==='security'">
        <header class="settings-content-head"><h1>隐私与安全</h1><p>{{isCommunityEdition?'管理应用锁与本机私密数据。':'管理登录密码与本机私密数据。'}}</p></header>
        <div class="privacy-settings">
          <AppLockSettings/>
          <AccountSettings v-if="!isCommunityEdition&&connected" key="security" ref="accountEditor" section="security" flat />
          <div v-else-if="!isCommunityEdition" class="setting-row"><span><b>登录密码</b><small>登录服务器后可修改账号密码。</small></span><button type="button" @click="selectSettingsTab('sync')">前往登录</button></div>
          <div class="setting-row"><span><b>私密保险箱</b><small>使用独立主密码加密保存，主密码由你保管。</small></span><button type="button" @click="router.push('/vault')">打开保险箱</button></div>
        </div>
      </template>
      <template v-else-if="!isCommunityEdition&&activeTab==='users'">
        <UserManagementView v-if="canManageUsers" ref="userEditor" embedded />
        <template v-else><header class="settings-content-head"><h1>用户管理</h1></header><p>此功能仅对已登录的服务器管理员开放。</p></template>
      </template>
      <template v-else-if="!isCommunityEdition&&activeTab==='sync'">
        <header class="settings-content-head"><h1>同步</h1><p>查看连接状态、同步日志与冲突，管理多设备同步。</p></header>
        <section class="setting-group"><h2>本地空间</h2><div class="account-summary"><span>{{Array.from(displayName)[0]}}</span><div><strong>{{displayName}}</strong><small>{{connected?`已连接 · ${profile?.serverBinding?.serverUrl||serverDisplay}`:'仅保存在本机，无需服务器'}}</small></div><button v-if="connected" @click="logout">断开同步</button><button v-else :disabled="isCommunityEdition" :title="isCommunityEdition?'社区版未接入私有同步组件':undefined" @click="connectServer">连接同步服务</button></div></section>
        <section class="setting-group"><h2>同步状态</h2><div v-if="runtimeSyncIssues.length" class="sync-runtime-alert" role="alert"><strong>同步尚未完成</strong><p v-for="issue in runtimeSyncIssues" :key="issue.kind">{{issue.message}}</p><small>队列为空也可能发生连接、检查或拉取失败；可点击“立即同步”重试。</small></div><div class="setting-row"><span><b>自动同步</b><small>{{connected?'本机修改及时上传，收到服务器变更通知后拉取':'连接服务器后可启用多设备同步'}}</small></span><input v-model="syncEnabled" class="pc-switch" type="checkbox" :disabled="!connected" @change="saveSync" /></div><div class="setting-row"><span><b>{{syncActivity.running?'正在同步':connected?'多设备同步':'本地使用'}}</b><small>{{message||(connected?'查看下方待同步内容和冲突；连接正常不代表所有内容已经同步':'内容保存在当前设备')}}</small></span><button class="sync-inline-action" :aria-busy="syncActivity.running>0" :disabled="!syncEnabled||!connected||syncActivity.running>0||conflictBatchBusy" @click="syncNow">{{syncActivity.running?'正在同步…':'立即同步'}}</button></div><details class="settings-sync-connection"><summary>连接与检查记录 <span>{{syncDelivery.connected?'实时连接正常':'等待连接'}}</span></summary><div class="setting-row"><span><b>自动检查频率</b><small>通知连接正常时每 5 分钟检查；连接不可用时每 30 秒检查。没有变化时跳过同步。</small></span><span>{{syncDelivery.connected?'实时通知已连接':'使用兜底检查'}}</span></div><div class="setting-row"><span><b>最近检查</b><small>{{syncDelivery.error||'后台检查不代表正在传输数据'}}</small></span><span>{{syncDelivery.lastCheckedAt?new Date(syncDelivery.lastCheckedAt).toLocaleTimeString('zh-CN'):'尚未检查'}}</span></div></details></section>
        <SyncReadinessPanel :key="profile?.storageKey||'local'" :connected="connected" :inspection-busy="syncInspectionBusy" :owner-id="String(auth.user?.userId||'local')" :failed-tasks="failedTasks.length" :failed-changes="failedChanges.length" :conflicts="allConflicts.length">
         <template #issues>
          <section class="setting-group" aria-label="未上传的更改">
           <h2>内容需要处理（{{failedChanges.length}}）</h2>
           <p>查看具体原因后处理。上传结果待确认时，重试会沿用原请求标识。</p>
           <button class="pc-action pc-action--secondary" :disabled="failedChangesLoading||!!retryingChange" @click="loadFailedChanges">{{failedChangesLoading?'正在检查…':'重新检查'}}</button>
           <p v-if="failedChangesError" role="alert">{{failedChangesError}}</p>
           <p v-else-if="!failedChangesLoading&&!failedChanges.length">已检查的内容队列中未发现需要处理的上传记录。</p>
           <SyncIssueCard v-for="item in failedChanges" :key="item.operationId" :title="item.title" :entity-label="item.kind" :category="changeIssueKind(item)" :reason="item.message" :busy="retryingChange===item.operationId" :feedback="changeFeedback[item.operationId]">
            <template #actions>
             <button v-if="['note','note_body_update'].includes(item.entityType)" class="pc-action pc-action--secondary" @click="router.push({path:'/notes',query:{note:item.entityUid}})">打开笔记</button>
             <button class="pc-action pc-action--secondary" :disabled="!item.retryable||!connected||!syncEnabled||!!retryingChange||syncActivity.running>0||conflictBatchBusy" @click="retryFailedChange(item)">{{retryingChange===item.operationId?'正在处理…':changeIssueKind(item)==='unconfirmed'?'确认上传结果':'重试上传'}}</button>
            </template>
            <template #diagnostics><span>错误代码：{{item.code}}</span><span>操作编号：{{item.operationId}}</span><span v-if="item.diagnostic">{{item.diagnostic}}</span><button class="pc-action pc-action--text" @click="copyFailureDiagnostic(item)">复制脱敏诊断</button></template>
           </SyncIssueCard>
          </section>
          <section v-if="failedTasks.length||taskActionMessage" class="setting-group">
           <h2>任务需要处理（{{failedTasks.length}}）</h2>
           <p v-if="taskActionMessage&&!failedTasks.some(task=>taskFeedback[task.operationId]?.message===taskActionMessage)" role="status">{{taskActionMessage}}</p>
           <p v-if="taskCopyMessage" role="status">{{taskCopyMessage}}</p>
           <p>本机修改已保留。可以处理原因后重试，或放弃该任务的本机修改。</p>
           <SyncIssueCard v-for="task in failedTasks" :key="task.operationId" :title="task.title" entity-label="任务" :category="classifySyncIssue({status:'failed',sent:task.sent})||'unknown'" :reason="task.message" :busy="retryingTask===task.operationId||retryingTask===`discard:${task.operationId}`" :feedback="taskFeedback[task.operationId]">
            <template #actions><button class="pc-action pc-action--secondary" :disabled="!connected||!syncEnabled||!!retryingTask||syncActivity.running>0" @click="retryFailedTask(task.operationId)">{{retryingTask===task.operationId?'正在重试…':'重试上传'}}</button><button class="pc-action pc-action--danger" :disabled="!!retryingTask||syncActivity.running>0" @click="discardFailedTask(task)">{{retryingTask===`discard:${task.operationId}`?'正在丢弃…':'丢弃本机修改'}}</button></template>
            <template #diagnostics><span>{{task.cycle}}</span><span>错误代码：{{task.code}}</span><span>操作编号：{{task.operationId}}</span><button class="pc-action pc-action--text" @click="copyTaskFailure(task)">复制脱敏诊断</button></template>
           </SyncIssueCard>
          </section>
          <ConflictBatchPanel v-if="allConflicts.length||conflictBatchBusy||conflictBatchMessage" :items="allConflicts" :busy="conflictBatchBusy" :completed="conflictBatchCompleted" :total="conflictBatchTotal" :message="conflictBatchMessage" @resolve="resolveSelectedConflicts"/>
         </template>
         <template #diagnostics><SyncProgressPanel always-visible/></template>
        </SyncReadinessPanel>
      </template>
      <template v-else-if="activeTab==='general'"><header class="settings-content-head"><h1>通用</h1><p>控制启动行为与基础显示格式。</p></header><section class="setting-group"><h2>启动与关闭</h2><label class="setting-row"><span><b>启动后打开</b><small>进入迹语时默认显示的页面</small></span><select v-model="startPage" @change="savePreference('note-flow-pc-start-page',startPage)"><option value="/home">首页</option><option value="/notes">笔记</option><option value="/tasks">任务</option></select></label></section><section class="setting-group"><h2>首页与日志</h2><label class="setting-row"><span><b>每天自动追加到日志</b><small>进入首页时自动追加当天的农历、天气等提示，同一天只追加一次</small></span><input v-model="autoDailyBrief" type="checkbox" @change="savePreference('note-flow-home-daily-brief',String(autoDailyBrief))"/></label></section><section class="setting-group"><h2>语言与地区</h2><div class="setting-row"><span><b>应用语言</b></span><select disabled><option>简体中文</option></select></div><div class="setting-row"><span><b>日期格式</b></span><select disabled><option>YYYY-MM-DD</option></select></div></section></template>
      <template v-else-if="activeTab==='appearance'"><header class="settings-content-head"><h1>外观</h1><p>调整迹语的主题强调色。</p></header><section class="setting-group"><h2>主题模式</h2><div class="theme-cards"><button class="active"><span class="theme-light"/>明亮模式</button><button disabled><span class="theme-system"/>浅色模式</button><button disabled><span class="theme-dark"/>深色模式</button></div></section><section class="setting-group"><h2>主题色</h2><div class="accent-options"><button v-for="color in ['#0f6b4f','#3478df','#7b4cc9','#e78a13','#d94c41','#2799a3','#4d5863']" :key="color" :class="{active:accent===color}" :style="{background:color}" @click="chooseAccent(color)"/></div></section></template>
      <template v-else-if="activeTab==='editor'"><header class="settings-content-head"><h1>编辑器</h1><p>当前编辑器以 Markdown 和可靠自动保存为基础。</p></header><section class="setting-group"><h2>编辑偏好</h2><div class="setting-row"><span><b>默认编辑格式</b><small>所有笔记保持兼容 Markdown</small></span><select disabled><option>Markdown</option></select></div><div class="setting-row"><span><b>自动保存</b><small>输入停止约 0.7 秒后保存</small></span><input class="pc-switch" type="checkbox" checked disabled /></div><div class="setting-row"><span><b>拼写检查</b><small>后续接入编辑器语言服务</small></span><input class="pc-switch" type="checkbox" disabled /></div></section></template>
      <template v-else-if="activeTab==='tasks'"><header class="settings-content-head"><h1>任务与提醒</h1><p>每个任务可设置最多 5 个到期或提前提醒。</p></header><section class="setting-group"><h2>提醒能力</h2><div class="setting-row"><span><b>任务到期提醒</b><small>预设支持到期时、10/30 分钟、1 小时、1 天和 1 周，也可自定义</small></span><input class="pc-switch" type="checkbox" checked disabled /></div><div class="setting-row"><span><b>系统通知与后台运行</b><small>桌面应用关闭窗口后驻留托盘，并在首次授权提醒时启用开机自启；托盘“退出”会停止提醒</small></span><button disabled>原生通知</button></div></section></template>
      <template v-else-if="activeTab==='focus'"><header class="settings-content-head"><h1>专注与回顾</h1><p>设置专注节奏，并查看当前回顾能力。</p></header><section class="setting-group"><h2>专注</h2><label class="setting-row"><span><b>默认专注时长</b></span><select v-model.number="focusSettings.focusMinutes" @change="saveFocusSettings"><option :value="15">15 分钟</option><option :value="25">25 分钟</option><option :value="45">45 分钟</option><option :value="60">60 分钟</option></select></label><label class="setting-row"><span><b>短休息时长</b></span><select v-model.number="focusSettings.shortBreakMinutes" @change="saveFocusSettings"><option :value="5">5 分钟</option><option :value="10">10 分钟</option><option :value="15">15 分钟</option></select></label><label class="setting-row"><span><b>长休息时长</b></span><select v-model.number="focusSettings.longBreakMinutes" @change="saveFocusSettings"><option :value="15">15 分钟</option><option :value="20">20 分钟</option><option :value="30">30 分钟</option></select></label><label class="setting-row"><span><b>自动开始休息</b></span><input v-model="focusSettings.autoStartBreak" class="pc-switch" type="checkbox" @change="saveFocusSettings" /></label></section><section class="setting-group"><h2>回顾</h2><p v-if="focusMessage" role="status">{{focusMessage}}</p><div class="setting-row"><span><b>每日回顾</b><small>从左侧“回顾”入口查看笔记、任务和专注统计</small></span><button @click="router.push('/reviews')">打开回顾</button></div></section></template>
      <template v-else-if="activeTab==='ai'">
       <header class="settings-content-head"><h1>AI 服务</h1><p>选择模型的调用方式，保存后即可在 AI 助手中使用。</p></header>
       <AiChannelSettings ref="aiSettings" :disabled="aiBusy" @selected="selectAiChannel">
        <template #server>
         <p class="ai-account-description">内容经过迹语服务器后发送到模型供应商。仅使用此方式时需要登录迹语服务器。</p>
         <div v-if="!connected" class="setting-row"><span><b>登录后使用账号服务</b><small>你也可以选择上方的个人 API 或本地模型，直接开始配置。</small></span><button type="button" @click="connectServer">登录迹语服务器</button></div>
         <template v-else>
          <div class="setting-row"><span><b>{{aiConfig?.configured?'已配置个人账号模型':aiConfig?.systemAvailable?'使用服务器提供的模型':'尚未配置账号模型'}}</b><small>{{aiConfig?.configured?`${aiConfig.providerType} · ${aiConfig.model}`:aiConfig?.systemAvailable?'由管理员维护模型和额度':'请在下方配置个人模型，或联系管理员启用服务。'}}</small></span><button type="button" :disabled="aiBusy||!(aiConfig?.configured||aiConfig?.systemAvailable)" @click="aiSettings?.activateServer()">使用账号服务</button></div>
          <div v-if="aiConfig?.configured||aiConfig?.systemAvailable" class="data-actions"><button type="button" :disabled="aiBusy" @click="testAccountService">{{aiBusy?'正在处理…':'使用并测试账号服务'}}</button></div>
          <p v-if="aiConfig&&!aiConfig.personalAllowed" class="import-warning">管理员未开放个人账号模型配置。</p>
          <details v-if="aiConfig?.personalAllowed" class="ai-account-advanced" :open="!aiConfig.configured&&!aiConfig.systemAvailable||undefined"><summary>个人账号模型配置（由服务器代调用）</summary>
           <label class="setting-row"><span><b>服务商</b></span><select v-model="aiProvider" :disabled="aiBusy" @change="chooseAiProvider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option></select></label>
           <label class="setting-row"><span><b>模型 ID</b><small>填写当前账号有权调用的模型 ID。</small></span><input v-model.trim="aiModel" :disabled="aiBusy" autocomplete="off" /></label>
           <label class="setting-row"><span><b>API Key</b><small>由服务器加密保存，仅返回掩码；与客户端直连配置独立。</small></span><input v-model="aiApiKey" type="password" :placeholder="aiConfig.configured?'已保存，留空不修改':'输入 API Key'" :disabled="aiBusy" autocomplete="new-password" /></label>
           <label class="setting-row"><span><b>启用个人账号模型</b><small>关闭后使用管理员默认模型。</small></span><input v-model="aiEnabled" class="pc-switch" type="checkbox" :disabled="aiBusy" /></label>
           <div class="data-actions"><button type="button" :disabled="aiBusy||!aiModel||(!aiApiKey&&!aiConfig.configured)" @click="saveAiConfig">保存并使用</button><button type="button" :disabled="aiBusy||!aiConfig.configured||!!aiApiKey||aiModel!==aiConfig.model||aiProvider!==aiConfig.providerType||aiEnabled!==(aiConfig.enabled!==false)" @click="testAiConfig">测试已保存配置</button><button v-if="aiConfig.configured" type="button" class="danger-text" :disabled="aiBusy" @click="removeAiConfig">删除账号授权</button></div>
           <p class="ai-settings-hint">修改后先保存，再测试；测试会发送简短消息，可能产生少量模型费用。</p>
          </details>
          <p v-if="aiMessage" role="status">{{aiMessage}}</p>
         </template>
        </template>
       </AiChannelSettings>
      </template>
      <template v-else-if="activeTab==='data'"><header class="settings-content-head"><h1>导入导出</h1><p>从其他工具迁入内容，或导出为开放格式。数据备份和恢复请前往“备份恢复”。</p></header><section class="setting-group"><h2>任务导入</h2><div class="import-entry"><span>✓</span><div><b>滴答清单 CSV</b><small>清单、任务、描述、日期、优先级、标签、重复和完成状态</small></div><label :class="{disabled:tickTickBusy}">选择 CSV<input type="file" accept="text/csv,.csv" :disabled="tickTickBusy" @change="previewTickTick" /></label></div><div v-if="tickTickPreview" class="obsidian-preview"><strong>{{tickTickFile?.name}}</strong><dl><div><dt>任务</dt><dd>{{tickTickPreview.total}}</dd></div><div><dt>清单</dt><dd>{{tickTickPreview.lists}}</dd></div><div><dt>标签</dt><dd>{{tickTickPreview.tags}}</dd></div><div><dt>重复任务</dt><dd>{{tickTickPreview.recurring}}</dd></div></dl><p v-for="warning in tickTickPreview.warnings" :key="warning" class="import-warning">{{warning}}</p><div class="data-actions"><button :disabled="tickTickBusy" @click="executeTickTick">确认导入</button><button v-if="tickTickBatchUid" :disabled="tickTickBusy" @click="rollbackTickTick">回滚本次导入</button><button v-if="canInspectTickTickScopes()" :disabled="tickTickBusy" @click="inspectTickTickScopes">检查旧任务归属</button></div></div><div v-if="tickTickScopeInspection" class="obsidian-preview"><strong>旧任务归属检查</strong><p>使用原 CSV 核对当前服务器已导入的任务。</p><p>可修复 {{tickTickScopeInspection.repairs.length}} 项 · 已一致 {{tickTickScopeInspection.consistent}} 项</p><p v-for="(count,reason) in tickTickScopeInspection.blocked" :key="reason" class="import-warning">{{tickTickScopeReasons[reason]||'需人工核对'}}：{{count}} 项，保持不变</p><p v-if="tickTickScopeInspection.repairs.length>1000" class="import-warning">请按完整父子任务分批检查，每次最多 1000 项。</p><button :disabled="tickTickBusy||!tickTickScopeInspection.repairs.length||tickTickScopeInspection.repairs.length>1000" @click="applyTickTickScopes">确认修复归属</button></div><p v-if="tickTickMessage">{{tickTickMessage}}</p><div v-if="tickTickResult" class="import-result"><span>成功 {{tickTickResult.success}}</span><span>重复跳过 {{tickTickResult.skipped}}</span><span :class="{error:tickTickResult.failed}">失败 {{tickTickResult.failed}}</span><ul v-if="tickTickResult.errors.length"><li v-for="error in tickTickResult.errors" :key="error"><small>{{error}}</small></li></ul></div></section><section class="setting-group"><h2>笔记导入</h2><div class="import-entry"><span>◇</span><div><b>导入 Obsidian Vault</b><small>Markdown、Frontmatter、标签、历史时间与正文附件</small></div><button v-if="isDesktopClient()&&!isCommunityEdition" :disabled="obsidianBusy" @click="chooseObsidianVault">选择文件夹</button><label v-else :class="{disabled:obsidianBusy}">选择文件夹<input type="file" webkitdirectory multiple :disabled="obsidianBusy" @change="selectObsidianVault" /></label></div><div v-if="obsidianScan" class="setting-row"><span><b>{{importResult?'最近一次导入':obsidianScan.rootName}}</b><small>{{importResult?`成功 ${importResult.success} · 跳过 ${importResult.skipped} · 失败 ${obsidianFailures.length}`:'已扫描，等待确认导入'}}</small></span><button @click="obsidianDialogOpen=true">{{importResult?'查看导入结果':'继续导入'}}</button></div><p v-else-if="obsidianProgress||obsidianMessage">{{obsidianProgress||obsidianMessage}}</p></section></template>
      <AboutProduct v-else />
      <details v-if="activeTab==='data'&&isDesktopClient()" class="setting-group"><summary>导入记录管理</summary><div class="setting-row"><span><b>可识别的导入记录</b><small>{{localImportSummary.notes?`${localImportSummary.notes} 篇笔记，来自 ${localImportSummary.batches} 个批次`:'旧版本平铺导入的数据没有批次标记，无法自动识别'}}</small></span><button v-if="localImportSummary.notes" class="danger-text" :disabled="obsidianBusy" @click="clearObsidianImports">删除导入批次</button></div></details>

      <details v-if="activeTab==='data'&&isDesktopClient()" class="setting-group"><summary>版本迁移</summary><EditionTransferPanel /></details>
      <details v-if="activeTab==='protection'&&connected&&!isCommunityEdition" class="setting-group backup-details"><summary>高级操作<span>重建与重置，请谨慎使用</span></summary>
      <section v-if="isDesktopClient()&&!isCommunityEdition&&profile?.serverBinding&&connected" class="setting-group"><h2>重建本机数据</h2><div class="setting-row"><span><b>重新初始化当前账号的本机空间</b><small>{{isCommunityEdition||!profile?.serverBinding?'纯本地空间不是同步缓存，不能从服务器重新拉取。请使用备份恢复。':'清除本机业务数据、同步队列、冲突、附件和录音，再从服务器重新拉取；保留账号、服务器地址、AI 配置和本地保险箱'}}</small></span><button :disabled="isCommunityEdition||!profile?.serverBinding||!connected||!online||dataBusy||obsidianBusy" :title="isCommunityEdition?'社区本地空间不能从服务器重建，请使用备份恢复':undefined" @click="inspectLocalWorkspace">{{resetPreview?'重新检查':'检查本机数据'}}</button></div><div v-if="resetPreview" class="obsidian-preview"><strong>当前账号本机数据</strong><dl><div><dt>待同步</dt><dd>{{resetPreview.pending}}</dd></div><div><dt>失败</dt><dd>{{resetPreview.failed}}</dd></div><div><dt>冲突</dt><dd>{{resetPreview.conflicts}}</dd></div><div><dt>附件 / 录音</dt><dd>{{resetPreview.attachments}} / {{resetPreview.recordings}}</dd></div><div><dt>卡片 / 复习记录</dt><dd>{{resetPreview.cards||0}} / {{resetPreview.cardReviewEvents||0}}</dd></div></dl><p v-if="resetPreview.resetInProgress" class="import-warning">检测到上次重建被中断，可以安全地再次执行。</p><p v-else-if="resetPreview.pending+resetPreview.failed+resetPreview.conflicts" class="import-warning">存在尚未同步的数据。你可以先逐条处理冲突，或者明确丢弃这些本机更改后重建。</p><div class="data-actions"><button v-if="resetPreview.conflicts" :disabled="dataBusy" @click="openLocalConflictResolution">处理 {{resetPreview.conflicts}} 条冲突</button><button class="danger-text" :disabled="dataBusy" @click="clearLocalWorkspace">{{resetPreview.pending+resetPreview.failed+resetPreview.conflicts?'丢弃本机更改并重建':'确认重建本机数据'}}</button></div></div></section>
      <section v-if="connected&&!isCommunityEdition" class="setting-group"><h2>云端重置</h2><div class="setting-row"><span><b>重置我的云端数据</b><small>删除当前账号的笔记、任务、项目等云端业务数据，并阻止其他设备上传旧数据；默认保留 AI 凭据和保险箱</small></span><button class="danger-text" :disabled="dataBusy||!online" @click="openCloudReset">预览并重置</button></div></section>
      </details>
      <p v-if="activeTab==='data'&&dataMessage" role="status">{{dataMessage}}</p>
      <section v-if="activeTab==='data'" class="setting-group"><h2>导出到 Obsidian</h2><div class="setting-row"><span><b>Obsidian Vault ZIP</b><small>{{localArchiveMode?'直接打包当前本地笔记和附件，包含未同步内容，无需服务器':'导出服务端已同步笔记，在 Obsidian 中继续编辑'}}</small></span><button :disabled="dataBusy" @click="exportObsidian">导出 ZIP</button></div><label class="setting-row"><span><b>包含任务</b><small>任务保存为可读且可还原的 Markdown checklist</small></span><input v-model="includeObsidianTasks" class="pc-switch" type="checkbox" /></label></section>
      <section v-if="activeTab==='data'" class="setting-group"><h2>安全回导迹语 ZIP</h2><div class="setting-row"><span><b>选择已导出的 Vault</b><small>{{localArchiveMode?'回导本地导出的 ZIP，先检查更新与冲突；不会请求服务器':'回导服务端导出的 ZIP，先检查更新与冲突'}}</small></span><label class="setting-file">选择 ZIP<input type="file" accept="application/zip,.zip" :disabled="obsidianBusy||localVaultWriter.hasChanges()||(!localArchiveMode&&!connected)" @change="previewObsidianArchive" /></label></div><div v-if="localArchiveMode&&localVaultWriter.hasChanges()" class="data-actions"><button :disabled="obsidianBusy" @click="rollbackObsidianArchive">回滚上次本地回导</button><button :disabled="obsidianBusy" @click="localVaultWriter.accept();obsidianArchivePreview=null;obsidianMessage='已保留回导结果，可继续导入'">保留回导结果</button></div><p v-if="obsidianMessage" role="status">{{obsidianMessage}}</p><div v-if="obsidianArchivePreview" class="obsidian-preview"><strong>预检结果 · {{obsidianArchivePreview.total}} 项</strong><dl><div><dt>创建</dt><dd>{{obsidianArchivePreview.counts.create||0}}</dd></div><div><dt>更新</dt><dd>{{obsidianArchivePreview.counts.update||0}}</dd></div><div><dt>跳过</dt><dd>{{obsidianArchivePreview.counts.skip||0}}</dd></div><div><dt>冲突副本</dt><dd>{{obsidianArchivePreview.counts.conflict||0}}</dd></div></dl><p v-if="obsidianArchivePreview.counts.conflict" class="import-warning">两端均有修改的内容不会覆盖原数据，而会创建冲突副本。</p><div class="data-actions"><button v-if="!obsidianArchivePreview.batchUid" :disabled="obsidianBusy||!!obsidianArchivePreview.counts.failed" @click="executeObsidianArchive">确认回导</button><button v-else :disabled="obsidianBusy" @click="rollbackObsidianArchive">回滚本次回导</button></div></div></section>
      <button v-if="activeTab==='data'&&importResult?.attachmentFailed&&!importResult.records.length" class="attachment-retry-action" :disabled="obsidianBusy" @click="retryFailedImport">重试失败附件</button>
      <section v-if="activeTab==='data'" class="setting-group"><h2>通用资源归档</h2><div class="setting-row"><span><b>Markdown 与资源 ZIP</b><small>{{localArchiveMode?'本地 Markdown、任务及附件资源；不含保险箱和账号密钥，不替代完整备份':'面向博客或其他系统，图片、音频和附件使用相对路径；需要连接服务端'}}</small></span><button :disabled="dataBusy" @click="exportPortableArchive">导出 ZIP</button></div></section>
      <div v-if="obsidianDialogOpen&&obsidianScan" class="obsidian-import-overlay" @click.self="!obsidianBusy&&(obsidianDialogOpen=false)">
        <section class="obsidian-import-dialog" role="dialog" aria-modal="true" aria-labelledby="obsidian-import-title">
          <header class="obsidian-import-head">
            <div class="obsidian-brand-mark" aria-hidden="true">◇</div>
            <div><span>OBSIDIAN VAULT</span><h2 id="obsidian-import-title">导入并整理知识库</h2><p>先确认扫描结果和整理方式，再写入迹语；源目录不会被修改。</p></div>
            <button type="button" aria-label="关闭导入窗口" :disabled="obsidianBusy" @click="obsidianDialogOpen=false">×</button>
          </header>
          <div class="obsidian-import-body">
            <section class="obsidian-vault-card">
              <div><i aria-hidden="true">⌁</i><span><strong>{{obsidianScan.rootName}}</strong><small>{{obsidianScan.items.length}} 篇 Markdown 已完成扫描<span v-if="obsidianScan.templateOnlyJournalCount">，已忽略 {{obsidianScan.templateOnlyJournalCount}} 篇空模板日记</span></small></span></div>
              <button v-if="isDesktopClient()&&!isCommunityEdition" type="button" :disabled="obsidianBusy" @click="chooseObsidianVault">重新选择</button><label v-else :class="{disabled:obsidianBusy}">重新选择<input type="file" webkitdirectory multiple :disabled="obsidianBusy" @change="selectObsidianVault" /></label>
            </section>
            <section class="obsidian-metrics" aria-label="扫描统计">
              <article><span>笔记</span><b>{{obsidianScan.items.length}}</b><small>Markdown</small></article>
              <article><span>标签</span><b>{{obsidianScan.tagCount}}</b><small>自动识别</small></article>
              <article><span>双向链接</span><b>{{obsidianScan.wikiLinkCount}}</b><small>保持关系</small></article>
              <article><span>附件</span><b>{{obsidianScan.attachmentCount}}</b><small>正文引用</small></article>
            </section>
            <div class="obsidian-import-columns">
              <section class="obsidian-option-panel">
                <header><span>1</span><div><h3>整理方式</h3><p>决定目录如何映射到迹语</p></div></header>
                <div class="obsidian-target-grid"><label><span>目标领域</span><select v-model="obsidianTargetAreaUid"><option value="">自动识别个人/工作</option><option v-for="area in obsidianAreas" :key="area.uid" :value="area.uid">{{area.name}}</option></select><small>来自当前工作区的真实领域</small></label><label v-if="obsidianProjectStrategy==='existing'"><span>目标项目</span><select v-model="obsidianTargetProjectUid"><option value="">请选择现有项目</option><option v-for="project in visibleObsidianProjects" :key="project.uid" :value="project.uid">{{project.name}} · {{obsidianAreas.find(area=>area.uid===project.areaUid)?.name||'未知领域'}}</option></select><small>选择项目后会自动对应其所属领域</small></label></div>
                <div class="obsidian-project-mode"><b>导入内容归属</b><label><input v-model="obsidianProjectStrategy" type="radio" value="none"><span>普通笔记</span></label><label><input v-model="obsidianProjectStrategy" type="radio" value="existing"><span>归入一个现有项目</span></label><label v-if="!isCommunityEdition"><input v-model="obsidianProjectStrategy" type="radio" value="top-level-folders"><span>顶层目录批量创建项目</span></label><small v-if="obsidianProjectStrategy==='top-level-folders'">将创建或复用 {{obsidianProjectFolders.length}} 个项目：{{obsidianProjectFolders.slice(0,4).join('、')}}{{obsidianProjectFolders.length>4?'…':''}}</small></div>
                <label class="obsidian-choice" :class="{selected:obsidianOrganization==='folders'}"><input v-model="obsidianOrganization" type="radio" value="folders"/><span><b>保留 Vault 目录</b><small>按原文件夹层级创建迹语目录，适合已经整理好的知识库。</small></span><i>推荐</i></label>
                <label class="obsidian-choice" :class="{selected:obsidianOrganization==='flat'}"><input v-model="obsidianOrganization" type="radio" value="flat"/><span><b>统一进入待整理</b><small>不创建原目录，导入后在收集箱集中整理。</small></span></label>
                <label class="obsidian-choice" :class="{selected:obsidianImportStandaloneFiles}"><input v-model="obsidianImportStandaloneFiles" type="checkbox"/><span><b>导入目录中的普通文件</b><small>{{obsidianScan.standaloneFileCount}} 个非敏感文件会生成目录文件节点，与笔记并排显示。</small></span></label>
              </section>
              <section class="obsidian-option-panel">
                <header><span>2</span><div><h3>外链图片</h3><p>{{obsidianScan.remoteImageCount}} 个远程图片引用</p></div></header>
                <label class="obsidian-choice" :class="{selected:remoteImagePolicy==='preserve'}"><input v-model="remoteImagePolicy" type="radio" value="preserve"/><span><b>保留原始链接</b><small>不下载远程内容，导入更快，也不会产生额外网络请求。</small></span><i>安全</i></label>
                <label v-if="!isCommunityEdition" class="obsidian-choice" :class="{selected:remoteImagePolicy==='private'}"><input v-model="remoteImagePolicy" type="radio" value="private"/><span><b>转为私有附件</b><small>安全下载成功后替换正文；失败时继续保留原链接。</small></span></label>
              </section>
            </div>
            <section class="obsidian-classification">
              <header><div><h3>自动整理预览</h3><p>导入时按内容和路径进行保守分类，不确定内容进入待整理。</p></div><span>{{obsidianScan.classification.inbox}} 篇待整理</span></header>
              <div><span>个人 <b>{{obsidianScan.classification.personal}}</b></span><span>工作 <b>{{obsidianScan.classification.work}}</b></span><span>日记 <b>{{obsidianScan.classification.journal}}</b></span><span>工作日志 <b>{{obsidianScan.classification.workJournal}}</b></span><span>移动来源 <b>{{obsidianScan.classification.mobile}}</b></span></div>
            </section>
            <aside v-if="obsidianScan.sensitiveFiles.length" class="obsidian-security-note"><b>⚠ {{obsidianScan.sensitiveFiles.length}} 项敏感内容将暂停导入</b><span>已检查路径、正文特征及密钥文件扩展名；证书、私钥和疑似密码不会写入普通笔记或附件库。</span></aside>
            <aside v-else class="obsidian-security-note safe"><b>✓ 未发现疑似私密配置</b><span>重复内容会自动跳过，原始文件与目录不会被修改。</span></aside>
            <section v-if="obsidianBusy||obsidianProgress" class="obsidian-import-progress"><div><span>{{obsidianProgress||'正在处理…'}}</span><b>{{obsidianImportPercent}}%</b></div><i><em :style="{width:`${obsidianImportPercent}%`}"/></i></section>
            <section v-if="importResult" class="obsidian-result-summary"><span><b>{{importResult.success}}</b> 笔记成功</span><span><b>{{importResult.skipped}}</b> 重复跳过</span><span :class="{error:importResult.failed}"><b>{{importResult.failed}}</b> 笔记失败</span><span><b>{{importResult.attachmentSuccess}}</b> 附件成功</span><span :class="{error:importResult.attachmentFailed}"><b>{{importResult.attachmentFailed}}</b> 附件失败</span><span v-if="importResult.remoteImageSuccess"><b>{{importResult.remoteImageSuccess}}</b> 外链转存</span><span v-if="importResult.remoteImagePreserved" class="notice"><b>{{importResult.remoteImagePreserved}}</b> 外链已保留</span><span v-if="importResult.remoteImageFailed" class="error"><b>{{importResult.remoteImageFailed}}</b> 外链失败</span><span v-if="importResult.taskSuccess"><b>{{importResult.taskSuccess}}</b> 任务识别</span><span v-if="importResult.taskFailed" class="error"><b>{{importResult.taskFailed}}</b> 任务失败</span></section>
            <section v-if="obsidianFailures.length" class="obsidian-failure-report" :class="{expanded:obsidianFailureDetailsOpen}"><header><span><b>失败明细</b><small>共 {{obsidianFailures.length}} 项</small></span><button type="button" @click="obsidianFailureDetailsOpen=!obsidianFailureDetailsOpen">{{obsidianFailureDetailsOpen?'收起':'展开'}} <strong>{{obsidianFailures.length}}</strong></button></header><div v-show="obsidianFailureDetailsOpen" class="obsidian-failure-list"><article v-for="(failure,index) in obsidianFailures" :key="`${failure.kind}:${failure.path}:${index}`"><span>{{failure.kind}}</span><div><strong :title="failure.path">{{failure.path}}</strong><small v-if="failure.context">来源笔记：{{failure.context}}</small><p>{{failure.reason}}</p></div></article></div></section>
            <p v-if="obsidianMessage" class="obsidian-dialog-message" :class="{error:/失败|错误/.test(obsidianMessage)}">{{obsidianMessage}}</p>
          </div>
          <footer class="obsidian-import-actions">
            <div><span>预计导入 {{obsidianScan.items.length-obsidianScan.classification.private}} 篇</span><small>私密配置、空模板日记和无法读取的文件不会导入</small></div>
            <button type="button" :disabled="obsidianBusy" @click="obsidianDialogOpen=false">稍后处理</button>
            <button v-if="!importResult" type="button" class="primary" :disabled="obsidianBusy" @click="startObsidianImport">{{obsidianBusy?'正在导入…':'确认并开始导入'}}</button>
            <button v-if="importResult&&importResult.records.some(item=>item.result==='failed')" type="button" :disabled="obsidianBusy" @click="retryFailedImport">重试失败笔记</button><button v-if="importResult" type="button" :disabled="obsidianBusy" @click="rollbackObsidianImport">回滚本次导入</button><button v-if="importResult" type="button" class="primary" :disabled="obsidianBusy" @click="obsidianDialogOpen=false">完成</button>
          </footer>
        </section>
      </div>
      <Teleport to="body"><div v-if="cloudResetOpen" class="obsidian-import-overlay cloud-reset-overlay" @click.self="!cloudResetBusy&&(cloudResetOpen=false)">
        <section ref="cloudResetPanel" tabindex="-1" class="obsidian-import-dialog cloud-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-reset-title">
          <header class="obsidian-import-head"><span class="obsidian-brand-mark">!</span><div><h2 id="cloud-reset-title">重置我的云端数据</h2><p>这是不可逆操作。建议先导出备份。</p></div><button type="button" :disabled="cloudResetBusy" @click="cloudResetOpen=false">×</button></header>
          <div class="obsidian-import-body">
            <div v-if="cloudResetPreview" class="obsidian-preview cloud-reset-preview"><strong>将删除的云端数据</strong><dl>
              <div><dt>笔记 / 任务 / 任务清单</dt><dd>{{cloudResetPreview.notes}} / {{cloudResetPreview.tasks}} / {{cloudResetPreview.taskLists}}</dd></div>
              <div><dt>画布</dt><dd>{{cloudResetPreview.canvases}}</dd></div>
              <div><dt>卡片 / 复习记录</dt><dd>{{cloudResetPreview.cards||0}} / {{cloudResetPreview.cardReviewEvents||0}}</dd></div>
              <div><dt>学习会话 / 成果来源 / 消息</dt><dd>{{cloudResetPreview.learningSessions||0}} / {{cloudResetPreview.learningResults||0}} / {{cloudResetPreview.notifications||0}}</dd></div>
              <div><dt>项目 / 领域</dt><dd>{{cloudResetPreview.projects}} / {{cloudResetPreview.areas}}</dd></div>
              <div><dt>项目日志 / 日记系列</dt><dd>{{cloudResetPreview.projectLogs}} / {{cloudResetPreview.journalSeries}}</dd></div>
              <div><dt>知识 / 主题 / 关系</dt><dd>{{cloudResetPreview.knowledge}} / {{cloudResetPreview.knowledgeTopics}} / {{cloudResetPreview.knowledgeRelations}}</dd></div>
              <div><dt>目录 / 标签 / 模板</dt><dd>{{cloudResetPreview.folders}} / {{cloudResetPreview.tags}} / {{cloudResetPreview.noteTemplates}}</dd></div>
              <div><dt>专注记录 / 设置</dt><dd>{{cloudResetPreview.focusSessions}} / {{cloudResetPreview.focusSettings}}</dd></div>
              <div><dt>导入批次 / 记录</dt><dd>{{cloudResetPreview.importBatches}} / {{cloudResetPreview.importRecords}}</dd></div>
              <div><dt>附件 / 录音</dt><dd>{{cloudResetPreview.attachments}} / {{cloudResetPreview.recordings}}</dd></div>
              <div><dt>附件容量</dt><dd>{{(cloudResetPreview.attachmentBytes/1024/1024).toFixed(2)}} MB</dd></div>
              <div><dt>同步队列 / 设备</dt><dd>{{cloudResetPreview.syncOperations}} / {{cloudResetPreview.activeDevices}}</dd></div>
            </dl><p class="import-hint">默认保留：登录账号和密码、{{cloudResetPreview.aiCredentials?'已配置的个人 AI 凭据':'个人 AI 凭据'}}、{{cloudResetPreview.cloudVault?'云端保险箱密文':'云端保险箱'}}。</p></div>
            <label class="cloud-reset-field"><span>当前登录密码</span><span class="cloud-reset-password"><input ref="cloudResetPasswordInput" v-model="cloudResetPassword" :type="cloudResetPasswordVisible?'text':'password'" autocomplete="current-password" :disabled="cloudResetBusy" /><button type="button" :disabled="cloudResetBusy" @click="cloudResetPasswordVisible=!cloudResetPasswordVisible">{{cloudResetPasswordVisible?'隐藏':'显示'}}</button></span></label>
            <label class="cloud-reset-field"><span>输入“RESET 我的数据”</span><input v-model="cloudResetConfirmation" autocomplete="off" :disabled="cloudResetBusy" /></label>
            <label><input v-model="deleteAiCredentials" type="checkbox" :disabled="cloudResetBusy||!cloudResetPreview?.aiCredentials"/> 同时删除个人 AI 凭据</label>
            <label><input v-model="deleteCloudVault" type="checkbox" :disabled="cloudResetBusy"/> 同时删除云端保险箱密文、历史快照及本机副本</label>
            <label><input v-model="createCloudResetBackup" type="checkbox" :disabled="cloudResetBusy"/> 重置前创建完整恢复点（推荐）</label>
            <p v-if="!createCloudResetBackup" class="import-warning">本次重置不会创建新备份。仅建议在预上线反复导入、且确认现有恢复点可用时关闭。</p>
            <p v-if="cloudResetMessage" class="import-warning">{{cloudResetMessage}}</p>
          </div>
          <footer class="obsidian-import-actions"><div><strong>账号和密码不会删除</strong><small>其他设备会在下次同步前自动丢弃旧本机数据</small></div><button type="button" :disabled="cloudResetBusy" @click="cloudResetOpen=false">取消</button><button type="button" class="primary" :disabled="cloudResetBusy||!cloudResetPreview||(!cloudResetPassword&&!cloudResetChallengeToken)||cloudResetConfirmation!=='RESET 我的数据'" @click="resetCloudAccount">{{cloudResetBusy?'正在处理…':'永久重置'}}</button></footer>
        </section>
      </div></Teleport>
    </main>
  </div>
</template>

<style scoped>
.sync-runtime-alert{margin:12px 0;padding:14px 16px;border:1px solid var(--pc-danger,#b8443b);border-radius:8px;color:var(--pc-danger,#b8443b);background:var(--pc-danger-soft,#fff1ef);overflow-wrap:anywhere}.sync-runtime-alert p{margin:8px 0;line-height:1.6}.sync-runtime-alert small{display:block;line-height:1.6}

.protection-summary{display:block;white-space:normal;font-size:10px;line-height:1.5;color:var(--muted);margin-top:4px}.settings-nav-group h2{margin:18px 12px 6px;font-size:11px;color:var(--muted);font-weight:600}.settings-nav-group{display:grid;gap:3px}

.cloud-reset-overlay{z-index:1000}
.cloud-reset-dialog{max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:hidden}.cloud-reset-dialog .obsidian-import-body{overflow:auto;min-height:0;overflow-wrap:anywhere}.cloud-reset-dialog .obsidian-import-actions{flex-wrap:wrap;flex-shrink:0}

.settings-content{padding:32px 40px 56px}.settings-content-head{margin-bottom:22px}.settings-content-head h1{font-size:24px;letter-spacing:-.025em}.settings-content-head p{font-size:12px;line-height:1.7}
.settings-nav{padding:20px 14px}.settings-nav>header{padding-bottom:16px}.settings-nav-group h2{margin:16px 10px 5px;font-size:10px;letter-spacing:.04em}.settings-nav-group:first-child h2{margin-top:4px}.settings-nav-group>button:not(:has(i)){padding-left:38px}.settings-nav nav button{min-height:36px;font-size:12px}.protection-summary{font-size:10px;line-height:1.6;max-width:135px}.setting-group{margin-bottom:22px;padding-bottom:22px}.setting-group>h2{font-size:13px;margin-bottom:10px}
@media(max-width:760px){.settings-content{padding:24px 20px 40px}}

.settings-content:has(.account-manager)>*{max-width:760px;margin-left:0;margin-right:0}
</style>

<style scoped>
.settings-sync-connection{border-top:1px solid var(--pc-border);margin-top:4px}.settings-sync-connection summary{display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:44px;color:var(--pc-muted);font-size:12px;cursor:pointer}.settings-sync-connection summary span{font-size:12px}.settings-sync-connection .setting-row{border-top:0;padding:10px 0}.setting-row .sync-inline-action{color:var(--pc-primary);background:var(--pc-primary-soft);border:0;box-shadow:none}
</style>

<style scoped>
.ai-account-description{color:var(--pc-muted,#718078);font-size:13px;line-height:1.7;margin:0 0 12px}.ai-account-advanced{margin-top:20px;border-top:1px solid var(--pc-border,#e4ebe6);padding-top:18px}.ai-account-advanced summary{cursor:pointer;font-size:13px;font-weight:500;margin-bottom:10px}.ai-settings-hint{font-size:12px;color:var(--pc-muted,#718078);line-height:1.7}
</style>

<style scoped>
.privacy-settings{max-width:760px}.privacy-settings>.setting-row{padding:20px 0;min-height:80px;border-bottom:1px solid var(--pc-border,#e4ebe6)}
</style>

<style scoped>
.backup-details{margin-top:24px}.backup-details>summary{display:flex;align-items:center;gap:12px;cursor:pointer;list-style:none;font-size:13px;font-weight:600;padding:12px 0}.backup-details>summary::before{content:'›';font-size:18px;color:var(--pc-muted)}.backup-details[open]>summary::before{transform:rotate(90deg)}.backup-details>summary span{font-size:12px;font-weight:400;color:var(--pc-muted)}.backup-details .setting-group{margin:12px 0 0}.storage-path{overflow-wrap:anywhere}.backup-hint,.backup-instructions{font-size:12px;line-height:1.8;color:var(--pc-muted)}.backup-instructions summary{cursor:pointer}.backup-details>summary::-webkit-details-marker{display:none}
</style>

<style scoped>
.backup-details>summary{min-height:48px;padding:8px 12px;margin:0 -12px;border-radius:7px;box-sizing:border-box}.backup-details>summary::before{transition:transform .15s}.backup-details>summary::after{content:'展开';margin-left:auto;flex-shrink:0;font-size:12px;font-weight:400;color:var(--pc-muted,#718078)}.backup-details[open]>summary::after{content:'收起'}.backup-details>summary:hover{background:var(--pc-primary-soft,#eef5f1)}.backup-details>summary:focus-visible{outline:2px solid var(--pc-primary,#26765b);outline-offset:2px}@media(max-width:600px){.backup-details>summary span{display:none}}
</style>
