<script setup lang="ts">
import { vaultDuplicateUids, vaultNeedsOrganization } from '../services/vaultOrganizer'
import {vaultCryptoSupportMessage} from '@note-flow/core/vault'
import { confirmDialog } from '../services/productDialog'
import {Capacitor} from '@capacitor/core'
import {registerLocalDraftGuard} from '../services/localDraftLifecycle'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import {isCommunityEdition,remoteServicesAvailable} from '../services/clientCapabilities'
import {exportCommunityFile} from '../community/fileExport'
import {saveLocalExport} from '../services/localFileExport'
import {captureFileExportBoundary} from '../services/fileExportBoundary'
import { useAuthStore } from '../stores/auth'
import { activeProfileId, syncAvailable } from '../services/profiles'
import { changeVaultMasterPassword, createVault, deleteVaultItem, exportVault, hasVault, importVault, listVaultItems, normalizeVaultUrls, saveVaultItem, saveVaultMetadataBatch, unlockVault, type VaultBackup, type VaultItem } from '../services/vault'
import { getRemoteVault, listVaultHistory, overwriteRemoteVault, restoreRemoteVault, restoreVaultHistory, syncVault, type RemoteVaultSnapshot, type VaultHistoryItem } from '../services/vaultSync'
import { workspaceService, type AreaEntity, type ProjectEntity } from '../services/workspace'
import { parseVaultImport,vaultImportExcelTemplate,vaultImportIdentity,type VaultImportItem } from '../services/vaultImport'
import { isDesktopClient } from '../services/serverConfig'
import { generateTotp,parseTotpInput } from '../services/totp'
import { decodeBase64Text, isProbablyBase64Text } from '../services/base64Assist'
import { armVaultSessionLock, clearVaultSession, ensureVaultSessionOwner, openVaultSession, vaultSessionItems, vaultSessionKey, vaultSessionRevision } from '../services/vaultSession'
import VaultBulkEditor from '../components/VaultBulkEditor.vue'
import {vaultBulkPatch, type VaultBulkChange} from '../services/vaultBulkEditing'
import VaultDynamicSecrets from '../components/VaultDynamicSecrets.vue'
import VaultAttachments from '../components/VaultAttachments.vue'
import VaultMarkdownImport from '../components/VaultMarkdownImport.vue'
import VaultPasswordGenerator from '../components/VaultPasswordGenerator.vue'
import { createVaultPassword } from '../services/vaultPassword'
import { globalAreaUid } from '../services/globalAreaScope'
import { vaultAreaUid, vaultMatchesContext, newVaultAttribution } from '../services/vaultAttribution'
import { ElCard, ElTag, ElDialog } from 'element-plus'
import { Key, Document, Monitor, Coin, Cloudy, Tickets, Timer, Collection, Notebook, CopyDocument, Link, View, Hide } from '@element-plus/icons-vue'
import 'element-plus/es/components/card/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/tag/style/css'
import 'element-plus/es/components/checkbox/style/css'
import '../styles/vaultPrototype.css'
import { ElButton, ElCollapse, ElCollapseItem, ElConfigProvider, ElDatePicker, ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon, ElSwitch, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect, type FormInstance, type FormRules, type FormItemRule } from 'element-plus'
import { ArrowLeft, ArrowDown, Upload, Download, Setting, Refresh, Lock, Plus, Search, Edit, Star, StarFilled, MoreFilled, Delete, Check } from '@element-plus/icons-vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/collapse/style/css'
import 'element-plus/es/components/collapse-item/style/css'
import 'element-plus/es/components/date-picker/style/css'
import 'element-plus/es/components/form/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/input-number/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/dropdown/style/css'
import 'element-plus/es/components/dropdown-item/style/css'
import 'element-plus/es/components/dropdown-menu/style/css'
import 'element-plus/es/components/icon/style/css'
import 'element-plus/es/components/switch/style/css'

const vaultCryptoMessage=vaultCryptoSupportMessage()
const auth = useAuthStore(), route=useRoute(), router = useRouter()
const profileRevision=ref(0)
const ownerId = computed(() => {profileRevision.value;return activeProfileId(auth.user?.userId || '')})
ensureVaultSessionOwner(ownerId.value)
const serverConnected = computed(()=>{profileRevision.value;return Boolean(auth.token)&&syncAvailable()})
const syncStateLabel=computed(()=>!remoteServicesAvailable?'仅保存在本机，云同步不可用':!syncEnabled.value?'仅本机保存':!serverConnected.value?'已启用，等待连接同步服务':syncStatus.value||'云同步已就绪')
const projectUid=computed(()=>typeof route.params.projectUid==='string'?route.params.projectUid:'')
const projectMode=computed(()=>Boolean(projectUid.value))
const projects=ref<ProjectEntity[]>([])
const areas=ref<AreaEntity[]>([])
const currentProject=computed(()=>projects.value.find(item=>item.uid===projectUid.value))
const exists = ref(Boolean(vaultSessionKey.value)), loading = ref(!vaultSessionKey.value), busy = ref(false), error = ref(''), query = ref('')
const masterPassword = ref(''), masterConfirmation = ref('')
const safetyAccepted = ref(false), changingMaster = ref(false), currentMaster = ref(''), nextMaster = ref(''), nextMasterConfirmation = ref('')
const lockMinutes = ref(Number(localStorage.getItem('jiyu-vault-lock-minutes') ?? 15))
const lockPolicyLabel=computed(()=>lockMinutes.value===0?'仅在手动锁定或关闭客户端后锁定':`闲置 ${lockMinutes.value} 分钟后自动锁定`)
const lastBackupAt = ref(localStorage.getItem(`jiyu-vault-last-backup:${ownerId.value}`) || '')
const cloudDiscoveryFailed=ref(false)
const syncEnabled = ref(localStorage.getItem(`jiyu-vault-sync-enabled:${ownerId.value}`)==='true'), syncStatus=ref(''), syncBusy=ref(false), syncConflict=shallowRef<RemoteVaultSnapshot|null>(null)
const cloudVersion=ref(Number(localStorage.getItem(`jiyu-vault-sync-version:${ownerId.value}`)||0)),cloudUpdatedAt=ref(localStorage.getItem(`jiyu-vault-sync-at:${ownerId.value}`)||''),cloudHistoryOpen=ref(false),cloudHistoryBusy=ref(false),cloudHistory=ref<VaultHistoryItem[]>([])
const key = vaultSessionKey, items = vaultSessionItems, selectedUid = ref(''), reveal = ref(false), editing = ref(false),advancedOpen=ref(false),totpCode=ref(''),totpRemaining=ref(0)
type VaultFilter='all'|'recent'|'favorite'|'attention'|'unorganized'
type VaultTypeFilter='all'|'archived'|NonNullable<VaultItem['credentialType']>
const listFilter=ref<VaultFilter>('all'),typeFilter=ref<VaultTypeFilter>('all'),copyMessage=ref('')
const privacyMode=ref(localStorage.getItem('jiyu-vault-privacy')==='true'), privacyRevealed=ref(false), notesExpanded=ref(false)
const maskDetails=computed(()=>privacyMode.value&&!privacyRevealed.value)
function privateText(value?:string){return value?(maskDetails.value?'••••••••':value):'—'}
watch(privacyMode,value=>{localStorage.setItem('jiyu-vault-privacy',String(value));privacyRevealed.value=false;reveal.value=false;closeBase64Decode()})
const categoryFilter=ref(''),environmentFilter=ref(''),projectFilter=ref(''),statusFilter=ref<NonNullable<VaultItem['status']>|''>('')
const listWidth=ref(Math.min(420,Math.max(280,Number(localStorage.getItem('jiyu-vault-list-width'))||320)))
watch(listWidth,value=>localStorage.setItem('jiyu-vault-list-width',String(value)))
let stopListResize=()=>{}
function startListResize(event:PointerEvent){
 const handle=event.currentTarget as HTMLElement,start=event.clientX,width=listWidth.value
 handle.setPointerCapture(event.pointerId)
 const move=(e:PointerEvent)=>{listWidth.value=Math.min(420,Math.max(280,width+e.clientX-start))}
 const stop=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);localStorage.setItem('jiyu-vault-list-width',String(listWidth.value))}
 stopListResize();stopListResize=stop;handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop)
}
onBeforeUnmount(()=>stopListResize())
const batchOpen=ref(false),bulkUndo=ref<VaultBulkChange[]>([])
function openBatch(){error.value='';batchOpen.value=true}
const duplicateUids=computed(()=>vaultDuplicateUids(scopedItems.value))
const unorganizedCount=computed(()=>scopedItems.value.filter(item=>vaultNeedsOrganization(item,duplicateUids.value)).length)
const categories=computed(()=>[...new Set(scopedItems.value.map(item=>item.category).filter(Boolean))].sort())
function clearFilters(){query.value='';listFilter.value='all';typeFilter.value='all';categoryFilter.value='';environmentFilter.value='';projectFilter.value='';statusFilter.value=''}
const activeFilters=computed(()=>[
 ...(listFilter.value==='all'?[]:[{key:'list',label:({recent:'最近使用',favorite:'收藏',attention:'待处理',unorganized:'待整理'} as const)[listFilter.value]}]),
 ...(typeFilter.value==='all'?[]:[{key:'type',label:typeFilter.value==='archived'?'已归档':credentialTypeLabel(typeFilter.value)}]),
 ...(categoryFilter.value?[{key:'category',label:privateText(categoryFilter.value)}]:[]),
 ...(environmentFilter.value?[{key:'environment',label:environmentLabel(environmentFilter.value as VaultItem['environment'])}]:[]),
 ...(projectFilter.value?[{key:'project',label:privateText(projects.value.find(item=>item.uid===projectFilter.value)?.name)}]:[]),
 ...(statusFilter.value?[{key:'status',label:statusLabel(statusFilter.value||undefined)}]:[]),
])
function removeFilter(name:string){if(name==='list')listFilter.value='all';else if(name==='type')typeFilter.value='all';else if(name==='category')categoryFilter.value='';else if(name==='environment')environmentFilter.value='';else if(name==='project')projectFilter.value='';else statusFilter.value=''}
async function applyBatch(changes:VaultBulkChange[],undo=false){
 if(!key.value||busy.value||!changes.length)return
 const action=captureVaultAction(),sessionKey=key.value
 const originals=new Map(items.value.map(item=>[item.uid,item]))
 busy.value=true;error.value=''
 try{
  const saved=await saveVaultMetadataBatch(action.owner,sessionKey,changes,action.assert)
  action.assert()
  // 撤销只恢复本次修改字段；使用提交后版本，拒绝覆盖其后的编辑。
  bulkUndo.value=undo?[]:saved.map(item=>({uid:item.uid,expectedUpdatedAt:item.updatedAt,patch:vaultBulkPatch(Object.fromEntries(Object.keys(changes.find(change=>change.uid===item.uid)!.patch).map(field=>[field,originals.get(item.uid)![field as keyof VaultItem]])))}))
  await loadItems();action.assert();batchOpen.value=false;clearVaultSelection();resetLockTimer()
  copyMessage.value=undo?`已撤销 ${saved.length} 条修改`:`已在本机保存 ${saved.length} 条修改`
  await runVaultSync()
 }catch(source){if(action.current())error.value=source instanceof Error?source.message:'批量修改失败，请重试'}finally{if(action.current())busy.value=false}
}
const recentUids=ref<string[]>(JSON.parse(localStorage.getItem(`jiyu-vault-recent:${ownerId.value}`)||'[]'))
const favoriteUids=ref<string[]>(JSON.parse(localStorage.getItem(`jiyu-vault-favorites:${ownerId.value}`)||'[]'))
const form = reactive({ title: '', url: '', urls:[{label:'主网址',url:''}], username: '', email:'',password: '',accessKey:'',secretKey:'',appId:'',appCode:'',tenantId:'',secretContent:'', notes: '', category: '',ownership:'' as NonNullable<VaultItem['ownership']>,organization:'',owner:'',tagsText:'',scopeType:'personal' as 'personal'|'project',areaUid:null as string|null,projectUid:null as string|null,credentialType:'login' as NonNullable<VaultItem['credentialType']>,status:'active' as NonNullable<VaultItem['status']>,environment:'' as NonNullable<VaultItem['environment']>,host:'',port:'',databaseName:'',privateKey:'',licenseKey:'',issuer:'',accountName:'',totpSecret:'',totpAlgorithm:'SHA-1' as NonNullable<VaultItem['totpAlgorithm']>,totpDigits:6 as 6|8,totpPeriod:30,recoveryCodesText:'',expiresAt:'',rotatedAt:'',lastVerifiedAt:'',revokedReason:'',replacesUid:null as string|null,reminderDays:30 })
const blankVaultForm=structuredClone(toRaw(form))
const historyImportOpen=ref(false),historyImportBusy=ref(false),historyImportName=ref(''),historyImportItems=ref<VaultImportItem[]>([]),historyImportErrors=ref<Array<{row:number;message:string}>>([]),historyImportMessage=ref(''),historyImportPolicy=ref<'skip'|'overwrite'|'keep'>('skip')
const historyImportDefaultAreaUid=ref<string|null>(null),historyImportDefaultProjectUid=ref('')
const selectionMode=ref(false)
function enterVaultSelection(){selectedVaultUids.value=[];selectionAnchor.value='';selectionMode.value=true}
const selectedVaultUids=ref<string[]>([]),selectionAnchor=ref(''),vaultDeleteBusy=ref(false)
const base64DialogOpen=ref(false),base64FieldLabel=ref(''),base64Input=ref(''),base64Output=ref(''),base64Error=ref('')
const detailPanel=ref<HTMLElement|null>(null)
const credentialForm=ref<FormInstance>()
const continueCreating=ref(false),generatorOpen=ref(false),backupDismissed=ref(false)
const detailMore=ref('')
const credentialTypes=[
  {value:'login',label:'密码',description:'网站、应用与系统账号',icon:Lock},
  {value:'api_key',label:'Token / API Key',description:'访问令牌与成对密钥',icon:Key},
  {value:'certificate',label:'证书 / 私钥',description:'SSL 证书与签名私钥',icon:Document},
  {value:'server',label:'服务器',description:'SSH 主机与登录凭据',icon:Monitor},
  {value:'database',label:'数据库',description:'数据库连接信息',icon:Coin},
  {value:'cloud',label:'云平台账号',description:'应用标识与租户信息',icon:Cloudy},
  {value:'license',label:'软件授权',description:'许可证与激活码',icon:Tickets},
  {value:'totp',label:'动态验证码',description:'TOTP 两步验证',icon:Timer},
  {value:'recovery_codes',label:'恢复码',description:'一次性备用验证码',icon:Collection},
  {value:'secure_note',label:'安全备注',description:'加密存储敏感正文',icon:Notebook},
  {value:'custom',label:'其他',description:'自定义安全记录',icon:Document},
] as const
const scopedItems=computed(()=>items.value.filter(item=>vaultMatchesContext(item,projects.value,globalAreaUid.value,projectUid.value)))
const eligibleProjects=computed(()=>projects.value.filter(project=>!form.areaUid||project.areaUid===form.areaUid))
function changeCredentialArea(){if(form.projectUid&&projects.value.find(project=>project.uid===form.projectUid)?.areaUid!==form.areaUid)form.projectUid=null}
function changeCredentialProject(){if(form.projectUid)form.areaUid=projects.value.find(project=>project.uid===form.projectUid)?.areaUid||null}
function changeImportArea(){if(historyImportDefaultProjectUid.value&&projects.value.find(project=>project.uid===historyImportDefaultProjectUid.value)?.areaUid!==historyImportDefaultAreaUid.value)historyImportDefaultProjectUid.value=''}
function changeImportProject(){if(historyImportDefaultProjectUid.value)historyImportDefaultAreaUid.value=projects.value.find(project=>project.uid===historyImportDefaultProjectUid.value)?.areaUid||null}
const selectedType=computed(()=>credentialTypes.find(type=>type.value===form.credentialType)||credentialTypes[0])
const acceptsPassword=computed(()=>['login','api_key','server','database','cloud','custom'].includes(form.credentialType))
const selectedProject=computed(()=>projects.value.find(project=>project.uid===selected.value?.projectUid))
const selectedArea=computed(()=>selected.value?areas.value.find(area=>area.uid===vaultAreaUid(selected.value!,projects.value)):undefined)
function itemIcon(item:VaultItem){return credentialTypes.find(type=>type.value===item.credentialType)?.icon||Lock}
function formatVaultDate(value?:string){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
const savedDays=computed(()=>selected.value?Math.max(0,Math.floor((Date.now()-new Date(selected.value.createdAt).getTime())/86400000)):0)
const selectedWebsite=computed(()=>{const raw=selected.value?.urls?.[0]?.url||selected.value?.url||'';try{const url=new URL(raw);return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return ''}})
async function togglePasswordGenerator(){generatorOpen.value=!generatorOpen.value;if(generatorOpen.value){await nextTick();detailPanel.value?.querySelector('.vault-inline-generator')?.scrollIntoView({block:'start',behavior:'smooth'})}}
async function useGeneratedPassword(value:string){if(!acceptsPassword.value||busy.value)return;form.password=value;generatorOpen.value=false;await nextTick();detailPanel.value?.querySelector('.vault-password-row')?.scrollIntoView({block:'nearest'})}
watch(()=>form.credentialType,()=>{generatorOpen.value=false})
const markdownImport=ref<InstanceType<typeof VaultMarkdownImport>>()
const lockOptions=[{value:0,label:'仅手动锁定'},{value:5,label:'闲置 5 分钟'},{value:15,label:'闲置 15 分钟'},{value:30,label:'闲置 30 分钟'},{value:60,label:'闲置 1 小时'}]
function handleVaultCommand(command:string|number){
  if(typeof command==='number'){lockMinutes.value=command;saveLockMinutes();return}
  switch(command){
    case 'import':openHistoryImport();break
    case 'markdown':markdownImport.value?.open();break
    case 'backup':void downloadBackup();break
    case 'history':void openCloudHistory();break
    case 'password':changingMaster.value=true;break
    case 'lock':lockVault();break
    case 'edit':editItem();break
    case 'copy-user':if(selected.value?.username)void copySecret(selected.value.username);break
    case 'copy-password':if(selected.value?.password)void copySecret(selected.value.password);break
    case 'copy-url':if(selectedWebsite.value)void copySecret(selectedWebsite.value);break
    case 'delete':void removeItem();break
  }
}
const advancedSection=computed({get:()=>advancedOpen.value?'more':'',set:(value:string|number)=>{advancedOpen.value=value==='more'}})
const credentialStatuses=[{value:'active',label:'有效'},{value:'expiring',label:'即将过期'},{value:'expired',label:'已过期'},{value:'revoked',label:'已作废'},{value:'compromised',label:'疑似泄露'},{value:'archived',label:'已归档'}]
const credentialRules:FormRules={
  title:[{required:true,whitespace:true,message:'请输入凭据名称',trigger:'blur'}],
  email:[{type:'email',message:'请输入有效的邮箱地址',trigger:'blur'}],

}
const urlRules:FormItemRule[]=[{validator:(_rule,value,callback)=>{
  if(!value?.trim())return callback()
  try {const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!url.hostname)throw new Error();callback()}
  catch {callback(new Error('请输入完整的 http:// 或 https:// 地址'))}
},trigger:'blur'}]
async function submitCredential(){
  if(busy.value)return

  if(!await credentialForm.value?.validate().catch(()=>false))return
  const shouldContinue=!selected.value&&continueCreating.value
  await saveItem()
  if(!error.value&&shouldContinue)newItem()
}
const vaultContext=reactive({open:false,x:0,y:0})
let totpTimer: ReturnType<typeof setInterval> | undefined
const selected = computed(() => items.value.find(item => item.uid === selectedUid.value))
const effectiveStatus=(item:VaultItem)=>item.status==='active'&&item.expiresAt&&new Date(item.expiresAt).getTime()<Date.now()?'expired':item.status||'active'
const needsAttention=(item:VaultItem)=>['expiring','expired','compromised'].includes(effectiveStatus(item))||(effectiveStatus(item)==='active'&&Boolean(item.expiresAt)&&new Date(item.expiresAt!).getTime()-Date.now()<Math.max(0,item.reminderDays??30)*86400000)
const filteredItems = computed(() => { const value = query.value.trim().toLowerCase(); return scopedItems.value.filter(item => (!categoryFilter.value||item.category===categoryFilter.value)&&(!environmentFilter.value||item.environment===environmentFilter.value)&&(!projectFilter.value||item.projectUid===projectFilter.value)&&(!statusFilter.value||effectiveStatus(item)===statusFilter.value)&&(!value || [item.title,item.url,...(item.urls||[]).flatMap(link=>[link.label,link.url]),item.username,item.email||'',item.accessKey||'',item.appId||'',item.tenantId||'',item.category,item.organization||'',item.owner||'',...(item.tags||[]),item.host||'',item.databaseName||'',item.issuer||'',item.licenseKey||''].some(field => field.toLowerCase().includes(value)))&&(listFilter.value==='all'||listFilter.value==='recent'&&recentUids.value.includes(item.uid)||listFilter.value==='favorite'&&favoriteUids.value.includes(item.uid)||listFilter.value==='attention'&&needsAttention(item)||listFilter.value==='unorganized'&&vaultNeedsOrganization(item,duplicateUids.value))&&(typeFilter.value==='all'||typeFilter.value==='archived'&&['archived','revoked'].includes(effectiveStatus(item))||item.credentialType===typeFilter.value)).sort((a,b)=>listFilter.value==='recent'?recentUids.value.indexOf(a.uid)-recentUids.value.indexOf(b.uid):b.updatedAt.localeCompare(a.updatedAt)) })
const attentionCount=computed(()=>scopedItems.value.filter(needsAttention).length)
const backupDue = computed(() => items.value.length>0&&!backupDismissed.value&&(!lastBackupAt.value||Date.now()-new Date(lastBackupAt.value).getTime()>30*86400000))
const backupStatusLabel=computed(()=>lastBackupAt.value?`上次独立备份：${new Date(lastBackupAt.value).toLocaleString()}`:'尚未创建独立备份')
const cloudStatusLabel=computed(()=>cloudVersion.value?`云端 v${cloudVersion.value}${cloudUpdatedAt.value?` · ${new Date(cloudUpdatedAt.value).toLocaleString()}`:''}`:'云端尚无快照')
const historyImportDuplicates=computed(()=>{const existing=new Set(items.value.map(item=>vaultImportIdentity({...item,areaUid:vaultAreaUid(item,projects.value)})));return historyImportItems.value.filter(item=>existing.has(vaultImportIdentity(resolvedImportItem(item)))).length})
const selectedVaultItems=computed(()=>{const values=new Set(selectedVaultUids.value);return items.value.filter(item=>values.has(item.uid))})

function resetLockTimer() { armVaultSessionLock(lockMinutes.value) }
function saveLockMinutes(){localStorage.setItem('jiyu-vault-lock-minutes',String(lockMinutes.value));resetLockTimer()}
function clearVaultViewState(){
 selectionMode.value=false;batchOpen.value=false;bulkUndo.value=[];privacyRevealed.value=false;
 busy.value=false;vaultDeleteBusy.value=false;syncBusy.value=false;cloudHistoryBusy.value=false;cloudHistoryOpen.value=false;cloudHistory.value=[];items.value=[];selectedUid.value='';selectedVaultUids.value=[];vaultContext.open=false;masterPassword.value='';currentMaster.value='';nextMaster.value='';nextMasterConfirmation.value='';masterConfirmation.value='';changingMaster.value=false;reveal.value=false;editing.value=false;totpCode.value=''
 historyImportBusy.value=false;historyImportOpen.value=false;historyImportItems.value=[];historyImportErrors.value=[];historyImportName.value='';historyImportMessage.value='';base64DialogOpen.value=false;base64Input.value='';base64Output.value='';base64Error.value=''
 for(const name of Object.keys(form))if(!(name in blankVaultForm))delete (form as Record<string,unknown>)[name]
 Object.assign(form,structuredClone(blankVaultForm))
}
function lockVault(){clearVaultSession();clearVaultViewState()}
function selectItem(uid:string){privacyRevealed.value=false;notesExpanded.value=false;selectedUid.value=uid;editing.value=false;reveal.value=false;base64DialogOpen.value=false;base64FieldLabel.value='';base64Input.value='';base64Output.value='';base64Error.value='';recentUids.value=[uid,...recentUids.value.filter(value=>value!==uid)].slice(0,8);localStorage.setItem(`jiyu-vault-recent:${ownerId.value}`,JSON.stringify(recentUids.value));void nextTick(()=>detailPanel.value?.scrollTo({top:0}));void refreshTotp()}
function selectListItem(uid:string,event:MouseEvent){vaultContext.open=false;if(event.shiftKey&&selectionAnchor.value){const values=filteredItems.value.map(item=>item.uid),from=values.indexOf(selectionAnchor.value),to=values.indexOf(uid);if(from>=0&&to>=0)selectedVaultUids.value=[...new Set([...selectedVaultUids.value,...values.slice(Math.min(from,to),Math.max(from,to)+1)])]}else if(selectionMode.value||event.ctrlKey||event.metaKey)selectedVaultUids.value=selectedVaultUids.value.includes(uid)?selectedVaultUids.value.filter(value=>value!==uid):[...selectedVaultUids.value,uid];else selectedVaultUids.value=[];selectionAnchor.value=uid;selectItem(uid)}
function selectAllVisible(){selectedVaultUids.value=filteredItems.value.map(item=>item.uid);selectionAnchor.value=selectedVaultUids.value.at(-1)||''}
function clearVaultSelection(){selectionMode.value=false;selectedVaultUids.value=[];selectionAnchor.value='';vaultContext.open=false}
function openVaultContextMenu(uid:string,event:MouseEvent){if(!selectedVaultUids.value.includes(uid))selectedVaultUids.value=[uid];selectionAnchor.value=uid;selectItem(uid);vaultContext.x=Math.min(event.clientX,window.innerWidth-210);vaultContext.y=Math.min(event.clientY,window.innerHeight-220);vaultContext.open=true}
function captureVaultAction(){
 const owner=ownerId.value,generation=vaultViewGeneration,sessionKey=key.value,revision=vaultSessionRevision()
 const current=()=>ownerId.value===owner&&vaultViewGeneration===generation&&key.value===sessionKey&&vaultSessionRevision()===revision
 const assert=()=>{if(!current())throw Error('保险箱已锁定或空间已变化，操作已取消')}
 return {owner,current,assert}
}
async function deleteSelectedVaultItems(){
 const values=selectedVaultItems.value.map(item=>({uid:item.uid,title:item.title}));if(!values.length||vaultDeleteBusy.value||busy.value)return
 const action=captureVaultAction(),names=values.slice(0,4).map(item=>`“${item.title}”`).join('、'),more=values.length>4?`等 ${values.length} 条`:''
 try{
  if(!await confirmDialog({title:`永久删除 ${values.length} 条凭据？`,message:`将删除 ${names}${more}。启用同步后，删除结果会同步到其他设备且无法撤销。`,confirmText:'永久删除',tone:'danger'}))return
  action.assert();vaultDeleteBusy.value=true
  for(const item of values){action.assert();await deleteVaultItem(action.owner,item.uid);action.assert()}
  selectedVaultUids.value=[];selectedUid.value='';await loadItems();action.assert();await runVaultSync()
 }catch(source){if(action.current())error.value=source instanceof Error?source.message:'批量删除失败'}finally{if(action.current()){vaultDeleteBusy.value=false;vaultContext.open=false}}
}
async function contextCopy(field:'username'|'password'){const item=selectedVaultItems.value.length===1?selectedVaultItems.value[0]:selected.value;if(item?.[field])await copySecret(item[field])}
function toggleFavorite(uid:string){favoriteUids.value=favoriteUids.value.includes(uid)?favoriteUids.value.filter(value=>value!==uid):[uid,...favoriteUids.value];localStorage.setItem(`jiyu-vault-favorites:${ownerId.value}`,JSON.stringify(favoriteUids.value))}
async function loadItems() {if(!key.value)return;const owner=ownerId.value,generation=vaultViewGeneration,sessionKey=key.value,values=await listVaultItems(owner,sessionKey);if(ownerId.value!==owner||generation!==vaultViewGeneration||key.value!==sessionKey)return;items.value=values;if(!editing.value&&!filteredItems.value.some(item=>item.uid===selectedUid.value))selectedUid.value=filteredItems.value[0]?.uid||''}
async function runVaultSync(){
 if(!syncEnabled.value||!key.value||syncBusy.value)return
 if(!syncAvailable()||!auth.token){syncStatus.value='请先连接并登录同步服务';return}
 const action=captureVaultAction();syncBusy.value=true;syncStatus.value='正在同步密文…'
 try{
  const result=await syncVault(action.owner);action.assert()
  if(result.status==='conflict'){syncConflict.value=result.remote;cloudVersion.value=result.version;syncStatus.value='本机和云端均有修改'}
  else{syncConflict.value=null;cloudVersion.value=result.version;cloudUpdatedAt.value=result.updatedAt||new Date().toISOString();localStorage.setItem(`jiyu-vault-sync-at:${action.owner}`,cloudUpdatedAt.value)
   if(result.status==='downloaded'){try{await loadItems();action.assert()}catch{if(action.current()){lockVault();syncStatus.value='云端保险箱使用了新的主密码，请重新解锁'}return}}
   syncStatus.value=result.status==='uploaded'?'密文已上传':result.status==='downloaded'?'已下载云端密文':'保险箱已同步'
  }
 }catch(source){if(!action.current())return;const message=source instanceof Error?source.message:'保险箱同步失败';if(message.includes('冲突')||message.includes('其他设备')){try{const remote=await getRemoteVault();action.assert();syncConflict.value=remote;syncStatus.value='本机和云端均有修改'}catch(errorSource){if(action.current())syncStatus.value=errorSource instanceof Error?errorSource.message:'无法读取云端冲突'}}else syncStatus.value=message}
 finally{if(action.current())syncBusy.value=false}
}
async function openCloudHistory(){
 const action=captureVaultAction();cloudHistoryOpen.value=true;cloudHistoryBusy.value=true
 try{const values=await listVaultHistory();action.assert();cloudHistory.value=values}catch(source){if(action.current())error.value=source instanceof Error?source.message:'无法读取云端历史'}finally{if(action.current())cloudHistoryBusy.value=false}
}
async function restoreCloudVersion(version:number){
 if(!key.value)return;const action=captureVaultAction(),expectedVersion=cloudVersion.value
 try{if(!await confirmDialog({title:`恢复云端版本 v${version}？`,message:'当前云端状态会保留在历史中，所选版本将成为新的当前版本并下载到本机。',confirmText:'确认恢复'}))return;action.assert();cloudHistoryBusy.value=true;const saved=await restoreVaultHistory(action.owner,version,expectedVersion);action.assert();cloudVersion.value=saved.version;cloudUpdatedAt.value=saved.updatedAt||new Date().toISOString();localStorage.setItem(`jiyu-vault-sync-at:${action.owner}`,cloudUpdatedAt.value);await loadItems();action.assert();cloudHistoryOpen.value=false;syncStatus.value=`已恢复历史版本 v${version}，当前为 v${saved.version}`}
 catch(source){if(action.current())error.value=source instanceof Error?source.message:'历史版本恢复失败'}finally{if(action.current())cloudHistoryBusy.value=false}
}
async function toggleVaultSync(){profileRevision.value++;if(!syncAvailable()||!auth.token){syncEnabled.value=false;syncStatus.value='请先连接并登录同步服务';return}localStorage.setItem(`jiyu-vault-sync-enabled:${ownerId.value}`,String(syncEnabled.value));if(syncEnabled.value)await runVaultSync();else{syncConflict.value=null;syncStatus.value='同步已关闭'}}
async function useRemote(){
 const remote=syncConflict.value;if(!remote)return;const action=captureVaultAction()
 try{await restoreRemoteVault(action.owner,remote);action.assert();syncConflict.value=null;try{await loadItems();action.assert();syncStatus.value='已使用云端版本'}catch{if(action.current()){lockVault();syncStatus.value='云端主密码已变化，请重新解锁'}}}catch(source){if(action.current())error.value=source instanceof Error?source.message:'云端恢复失败'}
}
async function useLocal(){
 const remote=syncConflict.value;if(!remote)return;const action=captureVaultAction()
 try{await overwriteRemoteVault(action.owner,remote.version);action.assert();syncConflict.value=null;syncStatus.value='已用本机密文覆盖云端'}catch(source){if(action.current())error.value=source instanceof Error?source.message:'云端覆盖失败'}
}
async function restoreFromCloud(){
 if(!serverConnected.value){error.value='请先连接同步服务';return}const action=captureVaultAction();error.value='';busy.value=true
 try{const remote=await getRemoteVault();action.assert();if(!remote)throw new Error('云端还没有保险箱');await restoreRemoteVault(action.owner,remote);action.assert();exists.value=true;syncEnabled.value=true;localStorage.setItem(`jiyu-vault-sync-enabled:${action.owner}`,'true')}catch(source){if(action.current())error.value=source instanceof Error?source.message:'云端恢复失败'}finally{if(action.current())busy.value=false}
}
async function setup() {
 const owner=ownerId.value,generation=vaultViewGeneration,current=()=>ownerId.value===owner&&vaultViewGeneration===generation
 error.value='';if(!safetyAccepted.value){error.value='请先确认主密码无法找回';return}if(masterPassword.value!==masterConfirmation.value){error.value='两次输入的主密码不一致';return}busy.value=true
 try{const opened=await createVault(owner,masterPassword.value);if(!current())return;openVaultSession(owner,opened);exists.value=true;masterPassword.value='';masterConfirmation.value='';resetLockTimer();if(route.query.create==='1')newItem()}
 catch(source){if(current())error.value=source instanceof Error?source.message:'创建失败'}finally{if(current())busy.value=false}
}
// 解锁期间可能换号或锁定；只有原owner及视图代次仍有效，才接纳返回的密钥和条目。
async function unlock() {
 const owner=ownerId.value,generation=vaultViewGeneration,current=()=>ownerId.value===owner&&vaultViewGeneration===generation
 error.value='';busy.value=true
 try{const opened=await unlockVault(owner,masterPassword.value);if(!current())return;openVaultSession(owner,opened);masterPassword.value='';await loadItems();if(!current())return;resetLockTimer();if(route.query.create==='1')newItem();await runVaultSync()}
 catch(source){if(current())error.value=source instanceof Error?source.message:'解锁失败'}finally{if(current())busy.value=false}
}
function newItem() { selectedUid.value=''; Object.assign(form,{title:'',url:'',urls:[{label:'主网址',url:''}],username:'',email:'',password:generatePassword(),accessKey:'',secretKey:'',appId:'',appCode:'',tenantId:'',secretContent:'',notes:'',category:'',ownership:'',organization:'',owner:'',tagsText:'',scopeType:'personal',...newVaultAttribution(globalAreaUid.value,projects.value,projectUid.value),credentialType:'login',status:'active',environment:'',host:'',port:'',databaseName:'',privateKey:'',licenseKey:'',issuer:'',accountName:'',totpSecret:'',totpAlgorithm:'SHA-1',totpDigits:6,totpPeriod:30,recoveryCodesText:'',expiresAt:'',rotatedAt:'',lastVerifiedAt:'',revokedReason:'',replacesUid:null,reminderDays:30});editing.value=true;advancedOpen.value=false;generatorOpen.value=false;reveal.value=false }
function editItem() { if(!selected.value)return;const urls=normalizeVaultUrls(selected.value.urls,selected.value.url);Object.assign(form,{ownership:'',organization:'',owner:'',scopeType:'personal',projectUid:null,credentialType:'login',status:'active',environment:'',host:'',port:'',databaseName:'',privateKey:'',licenseKey:'',issuer:'',accountName:'',totpSecret:'',totpAlgorithm:'SHA-1',totpDigits:6,totpPeriod:30,expiresAt:'',rotatedAt:'',lastVerifiedAt:'',revokedReason:'',replacesUid:null,reminderDays:30,...selected.value,areaUid:vaultAreaUid(selected.value,projects.value),tagsText:(selected.value.tags||[]).join(', '),urls:urls.length?urls:[{label:'主网址',url:''}],recoveryCodesText:(selected.value.recoveryCodes||[]).map(code=>code.value).join('\n')});editing.value=true;advancedOpen.value=false;generatorOpen.value=false;reveal.value=false }
function cancelEdit(){editing.value=false;reveal.value=false}
function addUrl(){form.urls.push({label:`网址 ${form.urls.length+1}`,url:''})}
function removeUrl(index:number){form.urls.splice(index,1);if(!form.urls.length)form.urls.push({label:'主网址',url:''})}
async function saveItem(){if(!key.value)return;const action=captureVaultAction(),sessionKey=key.value;error.value='';busy.value=true;try{form.scopeType=form.projectUid?'project':'personal';form.areaUid=vaultAreaUid(form,projects.value);form.url=form.urls.find(item=>item.url.trim())?.url.trim()||'';const recoveryCodes=form.recoveryCodesText.split(/[\n,;，；]+/).map(value=>value.trim()).filter(Boolean).map(value=>({value,used:selected.value?.recoveryCodes?.find(code=>code.value===value)?.used||false,usedAt:selected.value?.recoveryCodes?.find(code=>code.value===value)?.usedAt})),tags=form.tagsText.split(/[,，;；]+/).map(value=>value.trim()).filter(Boolean),password=['license','totp','recovery_codes','secure_note'].includes(form.credentialType)?'':form.password,baseTotp=form.credentialType==='totp'?parseTotpInput(form.totpSecret):null,isUri=form.totpSecret.toLowerCase().startsWith('otpauth://'),totp=baseTotp?isUri?baseTotp:{...baseTotp,algorithm:form.totpAlgorithm,digits:form.totpDigits,period:form.totpPeriod}:null;const item=await saveVaultItem(action.owner,sessionKey,{...structuredClone(toRaw(form)),password,recoveryCodes,tags,...(totp?{totpSecret:totp.secret,totpAlgorithm:totp.algorithm,totpDigits:totp.digits,totpPeriod:totp.period,issuer:form.issuer||baseTotp?.issuer||'',accountName:form.accountName||baseTotp?.accountName||''}:{}),uid:selected.value?.uid,createdAt:selected.value?.createdAt});action.assert();await loadItems();action.assert();selectedUid.value=item.uid;editing.value=false;reveal.value=false;resetLockTimer();await refreshTotp();action.assert();await runVaultSync()}catch(source){if(action.current())error.value=source instanceof Error?source.message:'保存失败'}finally{if(action.current())busy.value=false}}
async function removeItem(){
 const item=selected.value;if(!item)return;const uid=item.uid,title=item.title,action=captureVaultAction()
 try{if(!await confirmDialog(`删除“${title}”？此操作无法撤销。`))return;action.assert();await deleteVaultItem(action.owner,uid);action.assert();selectedUid.value='';await loadItems();action.assert();await runVaultSync()}catch(source){if(action.current())error.value=source instanceof Error?source.message:'删除失败'}
}
function generatePassword(){return createVaultPassword({length:24,uppercase:true,lowercase:true,digits:true,symbols:true,avoidSimilar:true})}
function environmentLabel(value:VaultItem['environment']){return value?({local:'本地',home:'家庭',development:'开发',testing:'测试',staging:'预发布',production:'生产',dmz:'DMZ',internal:'内网'} as const)[value]:''}
function statusLabel(value:VaultItem['status']){return({active:'有效',expiring:'即将过期',expired:'已过期',revoked:'已作废',compromised:'疑似泄露',archived:'已归档'} as const)[value||'active']}
function credentialTypeLabel(value:VaultItem['credentialType']){return({login:'登录账号',server:'SSH',database:'数据库',api_key:'API Key',cloud:'云平台',license:'许可证',totp:'动态码',recovery_codes:'恢复码',certificate:'证书',secure_note:'安全备注',custom:'自定义'} as const)[value||'login']}
function credentialTypeIcon(value:VaultItem['credentialType']){return({login:'♙',server:'⌘',database:'▤',api_key:'⌁',cloud:'☁',license:'◇',totp:'◷',recovery_codes:'▦',certificate:'▣',secure_note:'▧',custom:'◆'} as const)[value||'login']}
function vaultItemSummary(item:VaultItem){const parts=[credentialTypeLabel(item.credentialType),privateText(item.category||'未分类'),item.environment?environmentLabel(item.environment):'',duplicateUids.value.has(item.uid)?'疑似重复':''];return parts.filter(Boolean).join(' · ')}
async function refreshTotp(){const item=selected.value;if(!item?.totpSecret||!key.value){totpCode.value='';totpRemaining.value=0;return}try{const result=await generateTotp({secret:item.totpSecret,algorithm:item.totpAlgorithm||'SHA-1',digits:item.totpDigits||6,period:item.totpPeriod||30});totpCode.value=result.code;totpRemaining.value=result.remaining}catch{totpCode.value='无法生成';totpRemaining.value=0}}
async function toggleRecoveryCode(index:number){const current=selected.value,codes=current?.recoveryCodes;if(!key.value||!current||!codes)return;const recoveryCodes=codes.map((code,position)=>position===index?{...code,used:!code.used,...(!code.used?{usedAt:new Date().toISOString()}:{usedAt:undefined})}:code);await saveVaultItem(ownerId.value,key.value,{...current,password:current.password,recoveryCodes});await loadItems();selectedUid.value=current.uid;resetLockTimer();await runVaultSync()}
async function copySecret(value:string){await navigator.clipboard.writeText(value);copyMessage.value='已复制，30 秒后自动清除';const copied=value;window.setTimeout(async()=>{copyMessage.value='';try{if(await navigator.clipboard.readText()===copied)await navigator.clipboard.writeText('')}catch{/* 浏览器可能不允许读取剪贴板 */}},30_000);resetLockTimer()}
function decodeBase64(){base64Error.value='';base64Output.value='';try{base64Output.value=decodeBase64Text(base64Input.value);resetLockTimer()}catch(source){base64Error.value=source instanceof Error?source.message:'Base64 解码失败'}}
function canDecodeBase64(value?:string){return Boolean(value&&isProbablyBase64Text(value))}
function openBase64Decode(label:string,value:string){base64FieldLabel.value=label;base64Input.value=value;base64DialogOpen.value=true;decodeBase64()}
function closeBase64Decode(){base64DialogOpen.value=false;base64FieldLabel.value='';base64Input.value='';base64Output.value='';base64Error.value=''}
async function downloadBackup(){
 error.value=''
 try{
  const boundary=captureFileExportBoundary(),owner=ownerId.value,sessionKey=key.value,sessionRevision=vaultSessionRevision()
  const assertCurrent=()=>{boundary();if(ownerId.value!==owner||key.value!==sessionKey||vaultSessionRevision()!==sessionRevision||!sessionKey)throw Error('保险箱已锁定或空间已变化，已取消备份')}
  assertCurrent()
  const payload=await exportVault(owner);assertCurrent()
  const content=JSON.stringify(payload),fileName=`迹语保险箱备份-${new Date().toISOString().slice(0,10)}.json`
  const saved=await saveLocalExport(new Blob([content],{type:'application/json'}),fileName,{kind:'vault-backup'},assertCurrent)
  assertCurrent()
  if(!saved){copyMessage.value='已取消备份';return false}
  lastBackupAt.value=new Date().toISOString()
  localStorage.setItem(`jiyu-vault-last-backup:${owner}`,lastBackupAt.value)
  copyMessage.value='加密备份已保存';resetLockTimer();return true
 }catch(source){error.value=source instanceof Error?source.message:'备份保存失败';return false}
}
async function changeMaster(){
 error.value='';if(nextMaster.value!==nextMasterConfirmation.value){error.value='两次输入的新主密码不一致';return}let action=captureVaultAction();const owner=action.owner,previous=currentMaster.value,next=nextMaster.value;busy.value=true
 try{const opened=await changeVaultMasterPassword(owner,previous,next);action.assert();openVaultSession(owner,opened);action=captureVaultAction();currentMaster.value='';nextMaster.value='';nextMasterConfirmation.value='';changingMaster.value=false;resetLockTimer();await runVaultSync()}catch(source){if(action.current())error.value=source instanceof Error?source.message:'主密码修改失败'}finally{if(action.current())busy.value=false}
}
async function restoreBackup(event:Event){
 const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;const action=captureVaultAction()
 try{const payload=JSON.parse(await file.text()) as VaultBackup;action.assert();if(!await confirmDialog('恢复会用备份替换当前账号的本地保险箱，继续吗？'))return;action.assert();await importVault(action.owner,payload);action.assert();exists.value=true;lockVault()}catch(source){if(action.current())error.value=source instanceof Error?source.message:'导入失败'}finally{input.value=''}
}
function resolvedImportItem(item:VaultImportItem){
  const {importScopeExplicit,...source}=item
  const result=importScopeExplicit?source:{...source,areaUid:historyImportDefaultAreaUid.value,projectUid:historyImportDefaultProjectUid.value||null}
  return {...result,areaUid:vaultAreaUid(result,projects.value),scopeType:result.projectUid?'project' as const:'personal' as const}
}
function importAttributionLabel(item:VaultImportItem){const value=resolvedImportItem(item);return [areas.value.find(area=>area.uid===value.areaUid)?.name||'未指定领域',value.projectUid?projects.value.find(project=>project.uid===value.projectUid)?.name||'未知项目':'未关联项目'].join(' · ')}
function openHistoryImport(){historyImportOpen.value=true;historyImportName.value='';historyImportItems.value=[];historyImportErrors.value=[];historyImportMessage.value='';historyImportPolicy.value='skip';historyImportDefaultAreaUid.value=newVaultAttribution(globalAreaUid.value,projects.value,projectUid.value).areaUid;historyImportDefaultProjectUid.value=''}
async function previewHistoryImport(event:Event){
 const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;const action=captureVaultAction(),projectSnapshot=structuredClone(toRaw(projects.value)),areaSnapshot=structuredClone(toRaw(areas.value));historyImportMessage.value=''
 try{const source=/\.xlsx?$/i.test(file.name)?await file.arrayBuffer():await file.text();action.assert();const preview=parseVaultImport(source,file.name,{projects:projectSnapshot,areas:areaSnapshot});historyImportName.value=file.name;historyImportItems.value=preview.items;historyImportErrors.value=preview.errors;if(!preview.items.length)historyImportMessage.value='文件中没有可导入的有效记录'}catch(source){if(action.current()){historyImportItems.value=[];historyImportErrors.value=[];historyImportMessage.value=source instanceof Error?source.message:'无法解析导入文件'}}finally{input.value='';if(action.current())resetLockTimer()}
}
async function downloadHistoryTemplate(){historyImportMessage.value='';try{const bytes=new Uint8Array(vaultImportExcelTemplate());if(isCommunityEdition){historyImportMessage.value=await exportCommunityFile(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'迹语保险箱导入模板.xlsx')?'模板已保存':'已取消保存';return}if(isDesktopClient()){const path=await invoke<string|null>('save_vault_import_template',{bytes:[...bytes]});historyImportMessage.value=path?`模板已保存：${path}`:'已取消保存';return}const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='迹语保险箱导入模板.xlsx';link.style.display='none';document.body.appendChild(link);link.click();window.setTimeout(()=>{link.remove();URL.revokeObjectURL(url)},1000);historyImportMessage.value='模板已下载'}catch(source){historyImportMessage.value=source instanceof Error?source.message:'模板下载失败'}}
async function executeHistoryImport(){
 if(historyImportBusy.value)return;if(!key.value){historyImportMessage.value='保险箱已锁定，请关闭导入窗口并重新解锁后再导入';return}if(!historyImportItems.value.length){historyImportMessage.value='没有可导入的有效记录';return}
 const action=captureVaultAction(),sessionKey=key.value,policy=historyImportPolicy.value,batch=historyImportItems.value.map(item=>resolvedImportItem(structuredClone(toRaw(item))));historyImportBusy.value=true;historyImportMessage.value='';let imported=0,skipped=0
 try{const existing=new Map(items.value.map(item=>[vaultImportIdentity({...item,areaUid:vaultAreaUid(item,projects.value)}),item]));for(const scoped of batch){action.assert();const identity=vaultImportIdentity(scoped),current=existing.get(identity);if(current&&policy==='skip'){skipped++;continue}const saved=await saveVaultItem(action.owner,sessionKey,{...scoped,...(current&&policy==='overwrite'?{uid:current.uid,createdAt:current.createdAt}:{})});action.assert();existing.set(identity,saved);imported++}await loadItems();action.assert();resetLockTimer();await runVaultSync();action.assert();historyImportMessage.value=`导入完成：新增或更新 ${imported} 条${skipped?`，跳过重复 ${skipped} 条`:''}`;historyImportItems.value=[]}catch(source){if(action.current())historyImportMessage.value=source instanceof Error?source.message:'批量导入失败'}finally{if(action.current())historyImportBusy.value=false}
}
// Android back consumes the active local vault layer before leaving the page.
function dismissVaultLayer(){
  if(base64DialogOpen.value){closeBase64Decode();return true}
  if(historyImportOpen.value){if(!historyImportBusy.value)historyImportOpen.value=false;return true}
  if(cloudHistoryOpen.value){if(!cloudHistoryBusy.value)cloudHistoryOpen.value=false;return true}
  if(changingMaster.value){if(!busy.value)changingMaster.value=false;return true}
  if(vaultContext.open){vaultContext.open=false;return true}
  if(editing.value){
    if(!busy.value)void confirmDialog({title:'放弃本次凭据编辑？',message:'尚未保存的修改将被丢弃，已保存的凭据保持不变。',confirmText:'放弃编辑',cancelText:'继续编辑',tone:'warning'}).then(confirmed=>{if(confirmed&&!busy.value)cancelEdit()})
    return true
  }
  return busy.value||historyImportBusy.value||cloudHistoryBusy.value
}
const unregisterVaultBack=isCommunityEdition&&Capacitor.isNativePlatform()
  ?registerLocalDraftGuard({}, {flush:async()=>{},dismiss:dismissVaultLayer})
  :()=>{}
onBeforeUnmount(unregisterVaultBack)
let vaultViewGeneration=0
const profileChanged=()=>{profileRevision.value++}
const storageProfileChanged=(event:StorageEvent)=>{if(event.key===null||event.key.includes('profile'))profileChanged()}
function readVaultIdentifiers(name:string,owner:string){try{const value=JSON.parse(localStorage.getItem(`${name}:${owner}`)||'[]');return Array.isArray(value)&&value.every(id=>typeof id==='string')?value as string[]:[]}catch{return []}}
let availabilityRequest=0
async function loadVaultAvailability(owner:string,current:()=>boolean){
 const request=++availabilityRequest,valid=()=>current()&&request===availabilityRequest
 loading.value=true;cloudDiscoveryFailed.value=false
 try{
  const local=await hasVault(owner);if(!valid())return;exists.value=local
  if(!local&&remoteServicesAvailable&&serverConnected.value){
   const remote=await getRemoteVault();if(!valid())return
   if(remote){
    await restoreRemoteVault(owner,remote,true);if(!valid())return
    exists.value=true;syncEnabled.value=true;cloudVersion.value=remote.version;cloudUpdatedAt.value=remote.updatedAt||''
    localStorage.setItem(`jiyu-vault-sync-enabled:${owner}`,'true');localStorage.setItem(`jiyu-vault-sync-at:${owner}`,cloudUpdatedAt.value)
    syncStatus.value='已下载云端密文，请使用原主密码解锁'
   }
  }
 }catch(source){if(valid()){const local=await hasVault(owner);if(!valid())return;exists.value=local;cloudDiscoveryFailed.value=!local;error.value=source instanceof Error?source.message:'无法检查云端保险箱'}}
 finally{if(valid())loading.value=false}
}
function retryVaultDiscovery(){error.value='';const owner=ownerId.value,generation=vaultViewGeneration;void loadVaultAvailability(owner,()=>ownerId.value===owner&&vaultViewGeneration===generation)}
function refreshVaultOwner(owner:string){
 const generation=++vaultViewGeneration,current=()=>vaultViewGeneration===generation&&ownerId.value===owner
 lockVault();masterConfirmation.value='';currentMaster.value='';nextMaster.value='';nextMasterConfirmation.value='';changingMaster.value=false;safetyAccepted.value=false
 for(const name of Object.keys(form))if(!(name in blankVaultForm))delete (form as Record<string,unknown>)[name]
 Object.assign(form,structuredClone(blankVaultForm))
 base64DialogOpen.value=false;base64Input.value='';base64Output.value='';base64FieldLabel.value='';base64Error.value=''
 historyImportOpen.value=false;historyImportItems.value=[];historyImportErrors.value=[];historyImportName.value='';historyImportMessage.value='';historyImportDefaultAreaUid.value=null;historyImportDefaultProjectUid.value=''
 cloudHistoryOpen.value=false;cloudHistory.value=[];syncConflict.value=null;syncStatus.value='';query.value='';copyMessage.value='';listFilter.value='all';typeFilter.value='all';selectionAnchor.value='';generatorOpen.value=false;advancedOpen.value=false
 lastBackupAt.value=localStorage.getItem(`jiyu-vault-last-backup:${owner}`)||'';backupDismissed.value=false;recentUids.value=readVaultIdentifiers('jiyu-vault-recent',owner);favoriteUids.value=readVaultIdentifiers('jiyu-vault-favorites',owner)
 syncEnabled.value=localStorage.getItem(`jiyu-vault-sync-enabled:${owner}`)==='true';cloudVersion.value=Number(localStorage.getItem(`jiyu-vault-sync-version:${owner}`)||0);cloudUpdatedAt.value=localStorage.getItem(`jiyu-vault-sync-at:${owner}`)||''
 projects.value=[];areas.value=[];exists.value=false;loading.value=true;busy.value=false;vaultDeleteBusy.value=false;error.value=''
 void loadVaultAvailability(owner,current)
 void Promise.all([workspaceService.projects(undefined,true),workspaceService.areas()]).then(([p,a])=>{if(current()){projects.value=p;areas.value=a}}).catch(()=>{})
}
onMounted(async()=>{
 window.addEventListener('note-flow:profile-change',profileChanged);window.addEventListener('note-flow:community-profile-change',profileChanged);window.addEventListener('storage',storageProfileChanged)
 totpTimer=setInterval(()=>void refreshTotp(),1000);window.addEventListener('pointerdown',resetLockTimer);window.addEventListener('keydown',resetLockTimer)
 const owner=ownerId.value,generation=vaultViewGeneration,current=()=>ownerId.value===owner&&vaultViewGeneration===generation
 ensureVaultSessionOwner(owner)
 if(key.value){exists.value=true;loading.value=false;void loadItems().catch(source=>{if(current())error.value=source instanceof Error?source.message:'保险箱数据刷新失败'})}
 else await loadVaultAvailability(owner,current)
 if(!current())return
 void Promise.all([workspaceService.projects(undefined,true),workspaceService.areas()]).then(([p,a])=>{if(current()){projects.value=p;areas.value=a}}).catch(()=>{if(current()){projects.value=[];areas.value=[]}})
 resetLockTimer()
})
watch([globalAreaUid,projectUid],()=>{batchOpen.value=false;bulkUndo.value=[];clearVaultSelection()})
watch(filteredItems,values=>{const visible=new Set(values.map(item=>item.uid));selectedVaultUids.value=selectedVaultUids.value.filter(uid=>visible.has(uid));if(!editing.value&&!visible.has(selectedUid.value)){selectedUid.value=values[0]?.uid||'';privacyRevealed.value=false;reveal.value=false}})
watch(globalAreaUid,()=>{selectedVaultUids.value=[];vaultContext.open=false;if(!editing.value){selectedUid.value=filteredItems.value[0]?.uid||'';reveal.value=false}})
watch(scopedItems,()=>{if(!editing.value&&!scopedItems.value.some(item=>item.uid===selectedUid.value)){selectedUid.value=filteredItems.value[0]?.uid||'';reveal.value=false}})
watch(projectUid,()=>{selectedUid.value=filteredItems.value[0]?.uid||'';editing.value=false;reveal.value=false})
watch(key,value=>{if(!value)clearVaultViewState()},{flush:'sync'})
watch(serverConnected,connected=>{if(connected&&!exists.value&&!key.value)retryVaultDiscovery()})
watch(ownerId,refreshVaultOwner,{flush:'sync'})
watch(()=>route.query.request,()=>{if(route.query.create==='1'&&key.value)newItem()})
onBeforeUnmount(()=>{availabilityRequest++;clearInterval(totpTimer);window.removeEventListener('pointerdown',resetLockTimer);window.removeEventListener('keydown',resetLockTimer);window.removeEventListener('note-flow:profile-change',profileChanged);window.removeEventListener('note-flow:community-profile-change',profileChanged);window.removeEventListener('storage',storageProfileChanged)})
</script>

<template>
  <div class="vault-page vault-prototype" :class="{'project-vault-page':projectMode}">
    <header v-if="!projectMode&&!key" class="vault-header compact-tool-head"><ElButton text :icon="ArrowLeft" @click="router.back()">返回</ElButton><span class="vault-locked">● {{exists?'已锁定':'未创建'}}</span></header>
    <p v-if="vaultCryptoMessage" class="vault-error vault-crypto-environment" role="alert">{{vaultCryptoMessage}}</p>
    <div v-if="loading" class="vault-gate"><p>正在检查本地保险箱…</p></div>
    <section v-else-if="!exists&&cloudDiscoveryFailed" class="vault-gate"><h2>暂时无法确认保险箱状态</h2><p>未能读取云端密文，尚不能确定是否已有保险箱。请检查连接后重试。</p><p class="vault-error">{{error}}</p><ElButton type="primary" @click="retryVaultDiscovery">重新检查</ElButton><ElButton @click="cloudDiscoveryFailed=false;error=''">仅在本机创建</ElButton></section>
    <section v-else-if="!exists" class="vault-gate"><h2>创建本地保险箱</h2><p>主密码无法找回，请使用与迹语登录密码不同的强密码，并妥善保存加密备份。</p><label>主密码<input v-model="masterPassword" :disabled="Boolean(vaultCryptoMessage)" type="password" autocomplete="new-password" @keyup.enter="setup"></label><label>确认主密码<input v-model="masterConfirmation" :disabled="Boolean(vaultCryptoMessage)" type="password" autocomplete="new-password" @keyup.enter="setup"></label><label class="vault-safety"><input v-model="safetyAccepted" type="checkbox">我明白：忘记主密码后无法恢复保险箱内容</label><p v-if="error" class="vault-error">{{error}}</p><button class="primary-action" :disabled="busy||Boolean(vaultCryptoMessage)" @click="setup">创建保险箱</button><button v-if="remoteServicesAvailable" class="vault-cloud-restore" :disabled="busy" @click="restoreFromCloud">从云端密文恢复</button><label class="vault-import">从加密备份恢复<input type="file" accept="application/json,.json" @change="restoreBackup"></label></section>
    <section v-else-if="!key" class="vault-gate"><h2>保险箱已锁定</h2><p v-if="syncStatus">{{syncStatus}}</p><p>输入独立主密码解锁。{{lockPolicyLabel}}，切换窗口或应用页面不会立即锁定。</p><label>主密码<input v-model="masterPassword" :disabled="Boolean(vaultCryptoMessage)" type="password" autocomplete="current-password" autofocus @keyup.enter="unlock"></label><p v-if="error" class="vault-error">{{error}}</p><button class="primary-action" :disabled="busy||Boolean(vaultCryptoMessage)" @click="unlock">解锁</button><label class="vault-import">导入加密备份<input type="file" accept="application/json,.json" @change="restoreBackup"></label></section>
    <div v-if="key&&backupDue" class="vault-backup-reminder"><span>{{lastBackupAt?'距离上次独立备份已超过 30 天，建议更新加密备份。':'尚未创建独立备份，建议导出加密备份。'}}</span><ElButton :icon="Download" size="small" @click="downloadBackup">立即备份</ElButton><ElButton text aria-label="暂时关闭备份提醒" @click="backupDismissed=true">稍后</ElButton></div>
    <div v-if="key" class="vault-security-bar vault-element-toolbar">
      <ElButton v-if="!projectMode" text :icon="ArrowLeft" @click="router.back()">返回</ElButton>
      <div class="vault-sync-toggle">
        <ElSwitch v-model="syncEnabled" aria-label="启用云同步" :disabled="syncBusy||!remoteServicesAvailable" @change="toggleVaultSync" />
        <span><b>云同步</b><small :class="{'needs-connection':syncEnabled&&!serverConnected}">{{syncStateLabel}}{{syncEnabled&&cloudVersion?` · v${cloudVersion}`:''}}</small></span>
      </div>
      <div class="vault-toolbar-actions" role="group" aria-label="保险箱操作">
      <ElButton v-if="syncEnabled&&serverConnected" :icon="Refresh" :loading="syncBusy" @click="runVaultSync">立即同步</ElButton>
      <ElDropdown popper-class="vault-action-menu" trigger="click" placement="bottom-end" :hide-on-click="true" @command="handleVaultCommand">
        <ElButton :icon="Upload">导入<ElIcon class="el-icon--right"><ArrowDown /></ElIcon></ElButton>
        <template #dropdown><ElDropdownMenu>
          <ElDropdownItem command="import">Excel / CSV / JSON</ElDropdownItem>
          <ElDropdownItem command="markdown">Markdown 凭据</ElDropdownItem>
        </ElDropdownMenu></template>
      </ElDropdown>
      <ElDropdown popper-class="vault-action-menu" trigger="click" placement="bottom-end" :hide-on-click="true" @command="handleVaultCommand">
        <ElButton :icon="Download" :title="backupStatusLabel">导出<ElIcon class="el-icon--right"><ArrowDown /></ElIcon></ElButton>
        <template #dropdown><ElDropdownMenu>
          <ElDropdownItem command="backup" :icon="Download">导出加密备份</ElDropdownItem>
          <ElDropdownItem v-if="syncEnabled&&serverConnected" command="history">查看云端历史</ElDropdownItem>
        </ElDropdownMenu></template>
      </ElDropdown>
      <ElDropdown popper-class="vault-action-menu" trigger="click" placement="bottom-end" :hide-on-click="true" @command="handleVaultCommand">
        <ElButton :icon="Setting">安全设置<ElIcon class="el-icon--right"><ArrowDown /></ElIcon></ElButton>
        <template #dropdown><ElDropdownMenu>
          <ElDropdownItem disabled>自动锁定</ElDropdownItem>
          <ElDropdownItem v-for="option in lockOptions" :key="option.value" :command="option.value" :icon="lockMinutes===option.value?Check:undefined">{{option.label}}</ElDropdownItem>
          <ElDropdownItem divided command="password" :icon="Edit">修改主密码</ElDropdownItem>
        </ElDropdownMenu></template>
      </ElDropdown>
      <ElButton :type="privacyMode?'primary':undefined" :icon="privacyMode?Hide:View" :aria-pressed="privacyMode" @click="privacyMode=!privacyMode">隐私显示</ElButton>
      <ElButton :icon="Lock" @click="lockVault">立即锁定</ElButton>
      </div>
    </div>
    <VaultMarkdownImport v-if="key" ref="markdownImport" :default-area-uid="newVaultAttribution(globalAreaUid,projects,projectUid).areaUid" :projects="projects" hide-trigger :owner-id="ownerId" :vault-key="key" @changed="loadItems();runVaultSync()"></VaultMarkdownImport>
    <div v-if="key&&syncConflict" class="vault-sync-conflict"><div><strong>保险箱同步冲突</strong><span>本机和云端在上次同步后都有修改，请选择保留版本。</span></div><button @click="useRemote">使用云端</button><button @click="useLocal">覆盖云端</button></div>
    <p v-if="copyMessage" class="vault-copy-toast" role="status">{{copyMessage}}</p><main v-if="key" class="vault-workspace" :class="{'vault-edit-layout':editing}" :style="{'--vault-list-width':`${listWidth}px`}">
      <div v-if="selectionMode||selectedVaultUids.length" class="vault-bulk-bar" role="toolbar" aria-label="批量操作">
<b>已选 {{selectedVaultUids.length}} 条</b><button :disabled="busy" @click="selectAllVisible">全选</button><button :disabled="busy||editing||!selectedVaultUids.length" @click="openBatch">批量编辑</button><button :disabled="busy" @click="clearVaultSelection">取消</button><button class="danger-text" :disabled="vaultDeleteBusy||busy||!selectedVaultUids.length" @click="deleteSelectedVaultItems">{{vaultDeleteBusy?'正在删除…':'删除所选'}}</button>
</div>
<aside class="vault-list">
<div class="vault-list-actions">
<ElInput v-model="query" :prefix-icon="Search" placeholder="搜索名称、账号、主机或分类" clearable aria-label="搜索凭据" />
<ElButton type="primary" :icon="Plus" title="新建凭据" @click="newItem">新建</ElButton>
</div>
<nav class="vault-filters" aria-label="凭据筛选">
<ElButton :type="listFilter==='all'&&typeFilter==='all'?'primary':undefined" size="small" @click="listFilter='all';typeFilter='all'">全部 {{scopedItems.length}}</ElButton>
<ElButton size="small" :type="listFilter==='favorite'?'primary':undefined" @click="listFilter='favorite';typeFilter='all'">收藏</ElButton>
<ElDropdown trigger="click" :hide-on-click="true" @command="value=>listFilter=value"><ElButton size="small" :type="['attention','recent'].includes(listFilter)?'primary':undefined">{{listFilter==='attention'?'待处理':listFilter==='recent'?'最近':'筛选'}}<ElIcon><ArrowDown/></ElIcon></ElButton><template #dropdown><ElDropdownMenu><ElDropdownItem command="all">全部记录</ElDropdownItem><ElDropdownItem command="attention">待处理</ElDropdownItem><ElDropdownItem command="recent">最近使用</ElDropdownItem></ElDropdownMenu></template></ElDropdown>
<ElButton size="small" :type="listFilter==='unorganized'?'primary':undefined" @click="listFilter='unorganized'">待整理 {{unorganizedCount}}</ElButton>
<ElSelect v-model="typeFilter" size="small" aria-label="按凭据类型筛选" @change="listFilter='all'"><ElOption value="all" label="全部类型" /><ElOption v-for="type in credentialTypes" :key="type.value" :value="type.value" :label="type.label" /><ElOption value="archived" label="已归档" /></ElSelect>
<ElSelect v-model="categoryFilter" clearable size="small" placeholder="全部分类" aria-label="按分类筛选"><ElOption v-for="value in categories" :key="value" :value="value" :label="privateText(value)" /></ElSelect>
<ElSelect v-model="environmentFilter" clearable size="small" placeholder="全部环境" aria-label="按环境筛选"><ElOption v-for="value in ['local','home','development','testing','staging','production','dmz','internal'] as const" :key="value" :value="value" :label="environmentLabel(value)" /></ElSelect>
<ElSelect v-model="projectFilter" clearable size="small" placeholder="全部项目" aria-label="按项目筛选"><ElOption v-for="project in projects" :key="project.uid" :value="project.uid" :label="privateText(project.name)" /></ElSelect>
<ElSelect v-model="statusFilter" clearable size="small" placeholder="全部状态" aria-label="按状态筛选"><ElOption v-for="status in credentialStatuses" :key="status.value" :value="status.value" :label="status.label" /></ElSelect>
</nav>
<div v-if="activeFilters.length||query" class="vault-filter-tags"><ElTag v-for="filter in activeFilters" :key="filter.key" closable @close="removeFilter(filter.key)">{{filter.label}}</ElTag><ElButton text size="small" @click="clearFilters">清除筛选</ElButton></div>
<div class="vault-list-tools"><ElButton size="small" :disabled="busy||editing" :aria-pressed="selectionMode" @click="selectionMode?clearVaultSelection():enterVaultSelection()">{{selectionMode?'退出多选':'多选'}}</ElButton><ElButton size="small" @click="openBatch" :disabled="busy||editing">批量编辑</ElButton><ElButton v-if="bulkUndo.length" size="small" :disabled="busy||editing" @click="applyBatch(bulkUndo,true)">撤销批量修改</ElButton><small>{{filteredItems.length}} 条</small></div>
<button v-for="item in filteredItems" :key="item.uid" :class="{active:selectedUid===item.uid,'bulk-selected':selectedVaultUids.includes(item.uid)}" :aria-pressed="selectionMode?selectedVaultUids.includes(item.uid):undefined" @click="selectListItem(item.uid,$event)" @contextmenu.prevent="openVaultContextMenu(item.uid,$event)">
<span v-if="selectionMode" class="vault-selection-check" :class="{checked:selectedVaultUids.includes(item.uid)}" aria-hidden="true">{{selectedVaultUids.includes(item.uid)?'✓':''}}</span><span v-else :title="credentialTypeLabel(item.credentialType)"><ElIcon><component :is="itemIcon(item)" /></ElIcon></span>
<b><span class="vault-list-title">{{privateText(item.title)}}</span><small>{{vaultItemSummary(item)}}</small>
</b><span class="vault-list-meta"><time>{{formatVaultDate(item.updatedAt).slice(0,10)}}</time><ElIcon v-if="favoriteUids.includes(item.uid)" class="vault-favorite"><StarFilled /></ElIcon></span>
</button>
<p v-if="!filteredItems.length">{{query?'没有匹配凭据':listFilter!=='all'||typeFilter!=='all'?'这个筛选条件下还没有凭据':projectMode?'当前项目还没有凭据':'保险箱还是空的'}}</p>
</aside>
<button class="vault-list-resizer" role="separator" aria-label="调整列表宽度" aria-orientation="vertical" :aria-valuenow="listWidth" aria-valuemin="280" aria-valuemax="420" @pointerdown="startListResize" @keydown.left.prevent="listWidth=Math.max(280,listWidth-20)" @keydown.right.prevent="listWidth=Math.min(420,listWidth+20)"></button>
      <section ref="detailPanel" class="vault-detail" :class="{'show-advanced':advancedOpen,'is-editing':editing}">
        <template v-if="editing">
          <ElConfigProvider :locale="zhCn">
            <div class="vault-edit-title"><ElButton text :icon="ArrowLeft" :disabled="busy" @click="cancelEdit">返回</ElButton><h2>{{selected?'编辑':'新增'}}{{selectedType.label}}</h2></div>

        <ElForm ref="credentialForm" class="vault-element-editor" :model="form" :rules="credentialRules" label-position="top" :disabled="busy" @submit.prevent="submitCredential">
          <div class="vault-form-body">
          <ElFormItem label="凭据类型" prop="credentialType"><ElSelect v-model="form.credentialType"><ElOption v-for="type in credentialTypes" :key="type.value" :value="type.value" :label="type.label"><span>{{type.label}}</span><small class="vault-type-description">{{type.description}}</small></ElOption></ElSelect></ElFormItem>
          <ElFormItem label="名称" prop="title"><ElInput v-model="form.title" autocomplete="off" placeholder="例如：公司 GitLab" /></ElFormItem>
          <h3 class="vault-form-section"><ElIcon><Key /></ElIcon>凭据信息</h3>
          <div v-if="['server','database'].includes(form.credentialType)" class="vault-basic-grid"><ElFormItem label="主机 / IP" prop="host"><ElInput v-model="form.host" autocomplete="off" placeholder="example.com 或 198.51.100.10" /></ElFormItem><ElFormItem label="端口" prop="port"><ElInput v-model="form.port" inputmode="numeric" autocomplete="off" placeholder="可留空" /></ElFormItem></div>
          <ElFormItem v-if="form.credentialType==='database'" label="数据库名称" prop="databaseName"><ElInput v-model="form.databaseName" autocomplete="off" /></ElFormItem>
          <div v-if="['login','server','database','cloud','custom'].includes(form.credentialType)" class="vault-basic-grid"><ElFormItem label="用户名" prop="username"><ElInput v-model="form.username" autocomplete="off" placeholder="可留空" /></ElFormItem><ElFormItem label="邮箱" prop="email"><ElInput v-model="form.email" type="email" autocomplete="off" placeholder="可留空" /></ElFormItem></div>
          <template v-if="form.credentialType==='api_key'"><div class="vault-basic-grid"><ElFormItem label="Access Key" prop="accessKey"><ElInput v-model="form.accessKey" autocomplete="off" spellcheck="false" /></ElFormItem><ElFormItem label="Secret Key" prop="secretKey"><ElInput v-model="form.secretKey" type="password" show-password autocomplete="new-password" spellcheck="false" /><small class="vault-field-hint">云服务或开放平台的成对 API 凭据；Secret Key 请保密。</small></ElFormItem></div></template>
          <template v-if="form.credentialType==='cloud'"><div class="vault-basic-grid"><ElFormItem label="App ID" prop="appId"><ElInput v-model="form.appId" autocomplete="off" spellcheck="false" /></ElFormItem><ElFormItem label="租户 ID" prop="tenantId"><ElInput v-model="form.tenantId" autocomplete="off" spellcheck="false" /></ElFormItem></div><ElFormItem label="App Code" prop="appCode"><ElInput v-model="form.appCode" type="password" show-password autocomplete="new-password" spellcheck="false" /></ElFormItem></template>
          <ElFormItem v-if="!['license','totp','recovery_codes','secure_note','certificate'].includes(form.credentialType)" :label="form.credentialType==='login'?'密码':'密码 / Token'" prop="password"><div class="vault-password-row"><ElInput v-model="form.password" type="password" show-password autocomplete="new-password" /><ElButton native-type="button" :aria-expanded="generatorOpen" @click="togglePasswordGenerator">{{generatorOpen?'收起生成器':'生成密码'}}</ElButton></div><small class="vault-field-hint">网站登录密码、个人访问令牌；API Token 可单独填写，无需同时填写 AK/SK。</small></ElFormItem>
          <VaultPasswordGenerator v-if="acceptsPassword&&generatorOpen" class="vault-inline-generator" @use="useGeneratedPassword" @copy="copySecret" />
          <template v-if="form.credentialType==='totp'"><div class="vault-basic-grid"><ElFormItem label="发行方" prop="issuer"><ElInput v-model="form.issuer" autocomplete="off" /></ElFormItem><ElFormItem label="账户名称" prop="accountName"><ElInput v-model="form.accountName" autocomplete="off" /></ElFormItem></div><ElFormItem label="TOTP Secret 或 otpauth://" prop="totpSecret"><ElInput type="password" show-password v-model="form.totpSecret" autocomplete="off" spellcheck="false" /></ElFormItem></template>
          <template v-if="form.credentialType==='license'"><ElFormItem label="许可证密钥" prop="licenseKey"><ElInput type="password" show-password v-model="form.licenseKey" autocomplete="off" /><small class="vault-field-hint">软件序列号、激活码，不用于网站登录。</small></ElFormItem><ElFormItem label="发行方" prop="issuer"><ElInput v-model="form.issuer" autocomplete="off" /></ElFormItem></template>
          <ElFormItem v-if="form.credentialType==='recovery_codes'" label="备用验证码（每行一个）" prop="recoveryCodesText"><ElInput type="textarea" v-model="form.recoveryCodesText" :rows="6" autocomplete="off" spellcheck="false" /><small class="vault-field-hint">一次性恢复码，每行一个。</small></ElFormItem>
          <template v-if="['server','certificate'].includes(form.credentialType)"><ElFormItem v-if="form.credentialType==='certificate'" label="发行方" prop="issuer"><ElInput v-model="form.issuer" autocomplete="off" /></ElFormItem><ElFormItem label="私钥" prop="privateKey"><ElInput type="textarea" v-model="form.privateKey" :rows="6" autocomplete="off" spellcheck="false" /><small class="vault-field-hint">PEM/OpenSSH 私钥正文，请勿填写公钥。</small></ElFormItem></template>
          <ElFormItem v-if="form.credentialType==='secure_note'" label="加密正文" prop="secretContent"><ElInput type="textarea" v-model="form.secretContent" :rows="8" autocomplete="off" spellcheck="false" /></ElFormItem>
          <section v-if="['login','api_key','cloud','custom'].includes(form.credentialType)" class="vault-compact-urls"><header><div><strong>网址</strong><small>可选，可保存登录页、控制台等多个入口</small></div><ElButton native-type="button" link type="primary" size="small" @click="addUrl">＋ 添加网址</ElButton></header><div v-for="(link,index) in form.urls" :key="index" class="vault-url-row"><ElInput v-model="link.label" :aria-label="`网址 ${index+1} 名称`" :placeholder="index===0?'主网址':`网址 ${index+1}`" /><ElFormItem :prop="`urls.${index}.url`" :rules="urlRules"><ElInput v-model="link.url" type="url" :aria-label="`网址 ${index+1} 地址`" placeholder="https://" /></ElFormItem><ElButton native-type="button" :disabled="form.urls.length===1&&!link.url" aria-label="删除网址" title="删除网址" text type="danger" size="small" @click="removeUrl(index)">×</ElButton></div></section>
          <h3 class="vault-form-section"><ElIcon><Notebook /></ElIcon>备注</h3>
          <ElFormItem label="普通备注" prop="notes"><ElInput type="textarea" v-model="form.notes" :rows="3" /><small class="vault-field-hint">备注用于普通说明并直接展示，敏感正文请使用“安全备注”类型。</small></ElFormItem>
          <ElCollapse v-model="advancedSection" accordion class="vault-editor-more"><ElCollapseItem name="more" title="归属与分类 · 更多信息（可选）"><div class="vault-editor-more-fields"><div class="vault-basic-grid"><ElFormItem label="领域" prop="areaUid"><ElSelect v-model="form.areaUid" clearable placeholder="未指定" @change="changeCredentialArea"><ElOption v-for="area in areas" :key="area.uid" :value="area.uid" :label="area.name" /></ElSelect></ElFormItem><ElFormItem label="分类（可选）" prop="category"><ElInput v-model="form.category" placeholder="可留空" /></ElFormItem></div><ElFormItem label="关联项目（可选）" prop="projectUid"><ElSelect v-model="form.projectUid" clearable filterable placeholder="不关联项目" @change="changeCredentialProject"><ElOption v-for="item in eligibleProjects" :key="item.uid" :value="item.uid" :label="item.name" /></ElSelect></ElFormItem><div class="vault-basic-grid"><ElFormItem label="环境" prop="environment"><ElSelect v-model="form.environment"><ElOption value="" label="未指定" /><ElOption value="local" label="本地" /><ElOption value="home" label="家庭" /><ElOption value="development" label="开发" /><ElOption value="testing" label="测试" /><ElOption value="staging" label="预发布" /><ElOption value="production" label="生产" /><ElOption value="dmz" label="DMZ" /><ElOption value="internal" label="内网" /></ElSelect></ElFormItem></div><div class="vault-basic-grid"><ElFormItem label="所属组织" prop="organization"><ElInput v-model="form.organization" autocomplete="off" /></ElFormItem><ElFormItem label="负责人" prop="owner"><ElInput v-model="form.owner" autocomplete="off" /></ElFormItem></div><div class="vault-basic-grid"><ElFormItem label="标签" prop="tagsText"><ElInput v-model="form.tagsText" placeholder="多个标签用逗号分隔" /></ElFormItem></div><div class="vault-basic-grid"><ElFormItem label="到期时间" prop="expiresAt"><ElDatePicker v-model="form.expiresAt" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="可留空" clearable /></ElFormItem><ElFormItem label="提前提醒天数" prop="reminderDays"><ElInputNumber v-model="form.reminderDays" :min="0" :max="3650" controls-position="right" /></ElFormItem></div><div class="vault-basic-grid">
<ElFormItem label="状态" prop="status"><ElSelect v-model="form.status"><ElOption v-for="option in credentialStatuses" :key="option.value" :value="option.value" :label="option.label" /></ElSelect></ElFormItem>
<ElFormItem label="最后轮换时间" prop="rotatedAt"><ElDatePicker v-model="form.rotatedAt" type="date" value-format="YYYY-MM-DD" placeholder="可留空" clearable /></ElFormItem>
<ElFormItem label="最后验证时间" prop="lastVerifiedAt"><ElDatePicker v-model="form.lastVerifiedAt" type="date" value-format="YYYY-MM-DD" placeholder="可留空" clearable /></ElFormItem>
</div>
<ElFormItem v-if="['revoked','compromised'].includes(form.status)" label="作废或风险原因" prop="revokedReason"><ElInput v-model="form.revokedReason" type="textarea" :rows="2" /></ElFormItem>
<template v-if="form.credentialType==='totp'"><div class="vault-basic-grid"><ElFormItem label="算法" prop="totpAlgorithm"><ElSelect v-model="form.totpAlgorithm"><ElOption v-for="algorithm in ['SHA-1','SHA-256','SHA-512']" :key="algorithm" :value="algorithm" :label="algorithm" /></ElSelect></ElFormItem><ElFormItem label="位数" prop="totpDigits"><ElSelect v-model="form.totpDigits"><ElOption :value="6" label="6 位" /><ElOption :value="8" label="8 位" /></ElSelect></ElFormItem><ElFormItem label="周期（秒）" prop="totpPeriod"><ElInputNumber v-model="form.totpPeriod" :min="1" :max="300" controls-position="right" /></ElFormItem></div></template></div></ElCollapseItem></ElCollapse>
          <p v-if="form.environment==='production'" class="vault-production-warning">生产环境凭据，请确认后再保存。</p><p v-if="error" class="vault-error">{{error}}</p>
          </div>
          <footer class="vault-form-actions"><label v-if="!selected" class="vault-continue"><input v-model="continueCreating" type="checkbox">保存后继续新增</label><span v-else>内容在本机加密</span><ElButton native-type="button" @click="cancelEdit">取消</ElButton><ElButton type="primary" :loading="busy" native-type="submit">保存凭据</ElButton></footer>
        </ElForm>
          </ElConfigProvider>
        </template>
        <article v-else-if="selected" class="vault-record">
<header>
<span><ElIcon><component :is="itemIcon(selected)" /></ElIcon></span>
<div>
<small>{{statusLabel(effectiveStatus(selected))}} · {{selected.environment==='production'?'生产环境 · ':''}}{{privateText(selected.category)}}</small>
<h2>{{privateText(selected.title)}}</h2><ElButton v-if="privacyMode" text size="small" @click="privacyRevealed=!privacyRevealed;reveal=false">{{privacyRevealed?'隐藏本条信息':'临时显示本条信息'}}</ElButton>
</div>
<ElButton :icon="favoriteUids.includes(selected.uid)?StarFilled:Star" :title="favoriteUids.includes(selected.uid)?'取消收藏':'收藏'" :aria-label="favoriteUids.includes(selected.uid)?'取消收藏':'收藏'" @click="toggleFavorite(selected.uid)" />
<ElButton :icon="Edit" @click="editItem">编辑</ElButton><ElButton v-if="selectedWebsite" tag="a" :href="maskDetails?undefined:selectedWebsite" target="_blank" rel="noopener noreferrer">打开网站</ElButton>
<ElDropdown class="vault-detail-actions" popper-class="vault-action-menu" trigger="click" placement="bottom-end" :hide-on-click="true" @command="handleVaultCommand">
  <ElButton :icon="MoreFilled" title="更多操作" aria-label="更多操作" />
  <template #dropdown><ElDropdownMenu><ElDropdownItem v-if="selected.username" command="copy-user" :icon="CopyDocument">复制用户名</ElDropdownItem><ElDropdownItem v-if="selected.password" command="copy-password" :icon="CopyDocument">复制密码 / Token</ElDropdownItem><ElDropdownItem v-if="selectedWebsite" command="copy-url" :icon="Link">复制网址</ElDropdownItem><ElDropdownItem command="delete" divided :icon="Delete">永久删除</ElDropdownItem></ElDropdownMenu></template>
</ElDropdown>
</header>
<VaultDynamicSecrets v-if="selected&&!editing&&!maskDetails&&(selected.totpSecret||selected.recoveryCodes?.length)" :item="selected" :code="totpCode" :remaining="totpRemaining" @copy="copySecret" @toggle-recovery="toggleRecoveryCode" />
<ElCard shadow="never" class="vault-record-card"><template #header><div class="vault-card-heading"><h3><ElIcon><Document /></ElIcon>基本信息</h3><ElButton size="small" @click="editItem">编辑</ElButton></div></template>
<dl><div><dt>名称</dt><dd>{{privateText(selected.title)}}</dd></div><div><dt>类型</dt><dd>{{credentialTypeLabel(selected.credentialType)}}</dd></div><div>
<dt>网址</dt>
<dd v-if="selected.urls?.length" class="vault-url-list"><span v-for="link in selected.urls" :key="`${link.label}:${link.url}`"><b>{{privateText(link.label)}}</b><a :href="maskDetails?undefined:link.url" target="_blank" rel="noreferrer">{{privateText(link.url)}}</a><ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(link.url)" /></span></dd><dd v-else>—</dd>
</div>
</dl>
</ElCard>
<ElCard shadow="never" class="vault-record-card"><template #header><div class="vault-card-heading"><h3><ElIcon><Key /></ElIcon>凭据信息</h3><ElButton size="small" @click="editItem">编辑</ElButton></div></template><dl><div v-if="selected.issuer">
<dt>发行方</dt>
<dd>{{privateText(selected.issuer)}}</dd>
</div>
<div v-if="selected.host">
<dt>主机 / IP</dt>
<dd>{{privateText(selected.host)}}<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.host)" />
</dd>
</div>
<div v-if="selected.port">
<dt>端口</dt>
<dd>{{privateText(selected.port)}}<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.port)" />
</dd>
</div>
<div v-if="selected.databaseName">
<dt>数据库</dt>
<dd>{{privateText(selected.databaseName)}}<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.databaseName)" />
</dd>
</div>
<div v-if="selected.username||selected.accountName">
<dt>{{selected.credentialType==='totp'?'账户名称':'用户名'}}</dt>
<dd>{{privateText(selected.username||selected.accountName)}}<ElButton text v-if="selected.username" @click="copySecret(selected.username)">复制</ElButton>
</dd>
</div>
<div v-if="selected.email">
<dt>邮箱</dt>
<dd>{{privateText(selected.email)}}<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.email)" />
</dd>
</div>
<div v-if="selected.appId"><dt>App ID</dt><dd><code>{{privateText(selected.appId)}}</code><ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.appId)" /></dd></div>
<div v-if="selected.appCode"><dt>App Code</dt><dd><code>{{reveal&&!maskDetails?selected.appCode:'••••••••••••'}}</code><ElButton text :icon="reveal?Hide:View" :aria-label="reveal?'隐藏敏感内容':'显示敏感内容'" @click="reveal=!reveal" /><ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.appCode)" /></dd></div>
<div v-if="selected.tenantId"><dt>租户 ID</dt><dd><code>{{privateText(selected.tenantId)}}</code><ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.tenantId)" /></dd></div>
<div v-if="selected.secretContent"><dt>保密内容</dt><dd><code>{{reveal&&!maskDetails?selected.secretContent:'••••••••••••'}}</code><ElButton text :icon="reveal?Hide:View" :aria-label="reveal?'隐藏敏感内容':'显示敏感内容'" @click="reveal=!reveal" /><ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.secretContent)" /></dd></div>
<div v-if="selected.accessKey">
<dt>Access Key (AK)</dt>
<dd>
<code>{{privateText(selected.accessKey)}}</code>
<ElButton text v-if="canDecodeBase64(selected.accessKey)" @click="openBase64Decode('Access Key (AK)',selected.accessKey)">尝试解码</ElButton>
<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.accessKey)" />
</dd>
</div>
<div v-if="selected.secretKey">
<dt>Secret Key (SK)</dt>
<dd>
<code>{{reveal&&!maskDetails?selected.secretKey:'••••••••••••'}}</code>
<ElButton text :icon="reveal?Hide:View" :aria-label="reveal?'隐藏敏感内容':'显示敏感内容'" @click="reveal=!reveal" />
<ElButton text v-if="canDecodeBase64(selected.secretKey)" @click="openBase64Decode('Secret Key (SK)',selected.secretKey)">尝试解码</ElButton>
<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.secretKey)" />
</dd>
</div>
<div v-if="selected.password">
<dt>密码 / Token</dt>
<dd>
<code>{{reveal&&!maskDetails?selected.password:'••••••••••••'}}</code>
<ElButton text :icon="reveal?Hide:View" :aria-label="reveal?'隐藏敏感内容':'显示敏感内容'" @click="reveal=!reveal" />
<ElButton text v-if="canDecodeBase64(selected.password)" @click="openBase64Decode('密码 / Token',selected.password)">尝试解码</ElButton>
<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.password)" />
</dd>
</div>
<div v-if="selected.licenseKey">
<dt>许可证密钥</dt>
<dd>
<code>{{reveal&&!maskDetails?selected.licenseKey:'••••••••••••'}}</code>
<ElButton text :icon="reveal?Hide:View" :aria-label="reveal?'隐藏敏感内容':'显示敏感内容'" @click="reveal=!reveal" />
<ElButton text v-if="canDecodeBase64(selected.licenseKey)" @click="openBase64Decode('许可证密钥',selected.licenseKey)">尝试解码</ElButton>
<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.licenseKey)" />
</dd>
</div>
<div v-if="selected.totpSecret">
<dt>TOTP Secret</dt>
<dd>
<code>{{reveal&&!maskDetails?selected.totpSecret:'••••••••••••'}}</code>
<ElButton text :icon="reveal?Hide:View" :aria-label="reveal?'隐藏敏感内容':'显示敏感内容'" @click="reveal=!reveal" />
<ElButton text v-if="canDecodeBase64(selected.totpSecret)" @click="openBase64Decode('TOTP Secret',selected.totpSecret)">尝试解码</ElButton>
<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.totpSecret)" />
</dd>
</div>
<div v-if="selected.recoveryCodes?.length">
<dt>备用验证码</dt>
<dd>{{selected.recoveryCodes.filter(code=>!code.used).length}} 个未使用<ElButton text :icon="reveal?Hide:View" :aria-label="reveal?'隐藏敏感内容':'显示敏感内容'" @click="reveal=!reveal" />
<pre v-if="reveal&&!maskDetails">{{selected.recoveryCodes.map(code=>`${code.used?'[已用]':'[可用]'} ${code.value}`).join('\n')}}</pre>
</dd>
</div>
<div v-if="selected.privateKey">
<dt>私钥</dt>
<dd>
<code>{{reveal&&!maskDetails?selected.privateKey:'••••••••••••'}}</code>
<ElButton text :icon="reveal?Hide:View" :aria-label="reveal?'隐藏敏感内容':'显示敏感内容'" @click="reveal=!reveal" />
<ElButton text v-if="canDecodeBase64(selected.privateKey)" @click="openBase64Decode('私钥',selected.privateKey)">尝试解码</ElButton>
<ElButton text :icon="CopyDocument" aria-label="复制字段" @click="copySecret(selected.privateKey)" />
</dd>
</div>
</dl></ElCard>
<ElCard v-if="selected.notes" shadow="never" class="vault-record-card"><template #header><div class="vault-card-heading"><h3><ElIcon><Notebook /></ElIcon>备注</h3><ElButton size="small" @click="editItem">编辑</ElButton></div></template><p class="vault-record-note" :class="{'is-collapsed':!notesExpanded}">{{privateText(selected.notes)||'暂无备注'}}</p><ElButton v-if="!maskDetails&&selected.notes&&selected.notes.length>160" text @click="notesExpanded=!notesExpanded">{{notesExpanded?'收起备注':'展开备注'}}</ElButton></ElCard>
<section class="vault-attribution"><div class="vault-attribution-heading"><strong>归属与标签</strong><ElButton text size="small" @click="editItem">编辑</ElButton></div><div class="vault-attribution-values"><span v-if="selectedArea">领域：{{privateText(selectedArea.name)}}</span><span v-if="selected.projectUid">项目：{{privateText(projects.find(item=>item.uid===selected?.projectUid)?.name||'未知项目')}}</span><span v-if="selected.category">分类：{{privateText(selected.category)}}</span><span v-if="selected.organization">组织：{{privateText(selected.organization)}}</span><span v-if="selected.owner">负责人：{{privateText(selected.owner)}}</span><ElTag v-for="tag in selected.tags" :key="tag" type="info">{{privateText(tag)}}</ElTag><small v-if="!selectedArea&&!selected.projectUid&&!selected.category&&!selected.organization&&!selected.owner&&!selected.tags?.length">尚未设置归属与标签</small></div></section><ElButton v-if="!selected.notes" class="vault-add-note" text @click="editItem">＋ 添加备注</ElButton>
<ElCard shadow="never" class="vault-record-card"><ElCollapse v-model="detailMore" accordion><ElCollapseItem name="more" title="详细信息"><dl>



<div v-if="selected.rotatedAt"><dt>最后轮换</dt><dd>{{selected.rotatedAt}}</dd></div>
<div v-if="selected.lastVerifiedAt"><dt>最后验证</dt><dd>{{selected.lastVerifiedAt}}</dd></div>

<div v-if="selected.expiresAt">
<dt>到期时间</dt>
<dd>{{selected.expiresAt}}{{needsAttention(selected)?' · 需要处理':''}}</dd>
</div>
<div v-if="selected.revokedReason">
<dt>作废或风险原因</dt>
<dd>{{privateText(selected.revokedReason)}}</dd>
</div>
<div v-if="selected.environment">
<dt>环境</dt>
<dd>{{environmentLabel(selected?.environment)}}</dd>
</div>
<div><dt>状态</dt><dd>{{statusLabel(effectiveStatus(selected))}}</dd></div><div><dt>已保存</dt><dd>{{savedDays}} 天</dd></div><div><dt>创建时间</dt><dd>{{formatVaultDate(selected.createdAt)}}</dd></div><div><dt>最后修改</dt><dd>{{formatVaultDate(selected.updatedAt)}}</dd></div></dl></ElCollapseItem></ElCollapse></ElCard>
</article>
        <div v-else class="vault-empty"><strong>选择一条凭据</strong><p>或者创建第一条登录信息。</p><button class="primary-action" @click="newItem">新建凭据</button></div>
        <VaultAttachments v-if="selected&&!editing&&key&&!maskDetails" :owner-id="ownerId" :item-uid="selected.uid" :vault-key="key" @changed="runVaultSync" />
      </section>

    </main>
    <VaultBulkEditor v-if="key&&batchOpen" :items="scopedItems" :projects="projects" :initial-selection="selectedVaultUids" :busy="busy" :error="error" :masked="maskDetails" @close="batchOpen=false" @save="applyBatch" />
    <div v-if="changingMaster" class="pc-modal-backdrop" @click.self="changingMaster=false"><form class="vault-master-dialog" @submit.prevent="changeMaster"><header><h2>修改主密码</h2><button type="button" @click="changingMaster=false">×</button></header><p>所有保险箱条目将使用新主密码重新加密。</p><label>当前主密码<input v-model="currentMaster" type="password" autocomplete="current-password" required></label><label>新主密码<input v-model="nextMaster" type="password" autocomplete="new-password" required></label><label>确认新主密码<input v-model="nextMasterConfirmation" type="password" autocomplete="new-password" required></label><p v-if="error" class="vault-error">{{error}}</p><button class="primary-action" :disabled="busy">重新加密</button></form></div>
    <div v-if="base64DialogOpen" class="pc-modal-backdrop" @click.self="closeBase64Decode"><section class="vault-base64-dialog" role="dialog" aria-modal="true" aria-labelledby="vault-base64-title"><header><div><small>LOCAL DECODE</small><h2 id="vault-base64-title">{{base64FieldLabel}} · Base64 解码</h2><p>结果仅存在于当前窗口内存，不保存、不上传。</p></div><button aria-label="关闭" @click="closeBase64Decode">×</button></header><div class="vault-base64-result"><p v-if="base64Error" class="vault-error">{{base64Error}}</p><label v-else>解码结果<textarea :value="base64Output" rows="8" readonly spellcheck="false"></textarea></label></div><footer><button @click="closeBase64Decode">关闭</button><button class="primary-action" :disabled="!base64Output" @click="copySecret(base64Output)">复制结果</button></footer></section></div>
    <div v-if="vaultContext.open" class="vault-context-scrim" @pointerdown="vaultContext.open=false"></div>
    <div v-if="vaultContext.open" class="pc-context-menu" :style="{left:`${vaultContext.x}px`,top:`${vaultContext.y}px`}" @pointerdown.stop>
      <button :disabled="selectedVaultItems.length!==1||!selectedVaultItems[0]?.username" @click="contextCopy('username');vaultContext.open=false"><span>⧉</span><b>复制用户名</b></button>
      <button :disabled="selectedVaultItems.length!==1||!selectedVaultItems[0]?.password" @click="contextCopy('password');vaultContext.open=false"><span>●</span><b>复制密码 / Token</b></button>
      <button v-if="selectedVaultItems.length===1" @click="editItem();vaultContext.open=false"><span>✎</span><b>编辑凭据</b></button>
      <button @click="selectAllVisible();vaultContext.open=false"><span>✓</span><b>全选当前列表</b></button>
      <i></i><button class="danger" :disabled="vaultDeleteBusy" @click="deleteSelectedVaultItems"><span>×</span><b>删除所选 {{selectedVaultItems.length}} 条</b></button>
    </div>
    <div v-if="historyImportOpen" class="pc-modal-backdrop" @click.self="!historyImportBusy&&(historyImportOpen=false)"><section class="vault-history-import" role="dialog" aria-modal="true" aria-labelledby="vault-history-import-title"><header><div><small>HISTORY IMPORT</small><h2 id="vault-history-import-title">导入历史数据</h2><p>支持 Excel、CSV、JSON；确认后每条记录都会使用当前主密钥加密。</p></div><button :disabled="historyImportBusy" aria-label="关闭" @click="historyImportOpen=false">×</button></header><div class="vault-import-source"><label>选择 Excel、CSV 或 JSON<input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,.csv,text/csv,.json,application/json" @change="previewHistoryImport"></label><button @click="downloadHistoryTemplate">下载 Excel 模板</button></div><div v-if="historyImportName" class="vault-import-summary"><span><small>文件</small><strong>{{privateText(historyImportName)}}</strong></span><span><small>有效</small><strong>{{historyImportItems.length}}</strong></span><span><small>疑似重复</small><strong>{{historyImportDuplicates}}</strong></span><span><small>错误</small><strong>{{historyImportErrors.length}}</strong></span></div><div class="vault-import-default-scope"><label>默认领域<ElSelect v-model="historyImportDefaultAreaUid" clearable placeholder="未指定" @change="changeImportArea"><ElOption v-for="area in areas" :key="area.uid" :value="area.uid" :label="area.name" /></ElSelect></label><label>默认关联项目（可选）<ElSelect v-model="historyImportDefaultProjectUid" clearable filterable placeholder="不关联项目" @change="changeImportProject"><ElOption v-for="project in projects.filter(item=>!historyImportDefaultAreaUid||item.areaUid===historyImportDefaultAreaUid)" :key="project.uid" :value="project.uid" :label="project.name" /></ElSelect></label><small>默认值仅用于文件中未指定归属的记录；领域可独立填写，项目可留空。</small></div><label v-if="historyImportDuplicates" class="vault-import-policy">重复记录<select v-model="historyImportPolicy"><option value="skip">跳过已有记录（推荐）</option><option value="overwrite">更新已有记录</option><option value="keep">保留两条记录</option></select></label><div v-if="historyImportItems.length" class="vault-import-preview"><article v-for="(item,index) in historyImportItems.slice(0,8)" :key="index"><span><strong>{{privateText(item.title)}}</strong><small>{{item.credentialType}} · {{privateText(item.username||item.host||item.url||item.category)}} · {{privateText(importAttributionLabel(item))}}</small></span><em>{{item.password?'含密码/Token':'含私钥'}}</em></article><p v-if="historyImportItems.length>8">另有 {{historyImportItems.length-8}} 条记录</p></div><div v-if="historyImportErrors.length" class="vault-import-errors"><strong>以下记录不会导入</strong><span v-for="item in historyImportErrors.slice(0,8)" :key="`${item.row}-${item.message}`">第 {{item.row}} 行：{{item.message}}</span></div><p v-if="historyImportMessage" class="vault-import-message">{{historyImportMessage}}</p><p class="vault-import-warning">导入文件包含明文密码。完成后请从下载目录和回收站中安全删除原文件。</p><footer><button :disabled="historyImportBusy" @click="historyImportOpen=false">取消</button><button class="primary-action" :disabled="historyImportBusy||!historyImportItems.length" @click="executeHistoryImport">{{historyImportBusy?'正在加密导入…':`确认导入 ${historyImportItems.length} 条`}}</button></footer></section></div>
    <div v-if="cloudHistoryOpen" class="pc-modal-backdrop" @click.self="!cloudHistoryBusy&&(cloudHistoryOpen=false)"><section class="vault-cloud-history" role="dialog" aria-modal="true"><header><div><small>ENCRYPTED SNAPSHOTS</small><h2>云端保险箱历史</h2><p>服务器仅保存密文，保留最近 10 个同步版本。</p></div><button :disabled="cloudHistoryBusy" @click="cloudHistoryOpen=false">×</button></header><div class="vault-cloud-history-list"><p v-if="cloudHistoryBusy">正在读取云端历史…</p><p v-else-if="!cloudHistory.length">还没有可恢复的云端历史。</p><article v-for="item in cloudHistory" :key="item.version"><span><strong>版本 v{{item.version}}</strong><small>{{new Date(item.createdAt).toLocaleString()}}{{item.version===cloudVersion?' · 当前版本':''}}</small></span><button :disabled="cloudHistoryBusy||item.version===cloudVersion" @click="restoreCloudVersion(item.version)">恢复此版本</button></article></div><footer><span>恢复操作会生成新版本，不会覆盖或删除原历史。</span><button @click="cloudHistoryOpen=false">关闭</button></footer></section></div>
  </div>
</template>

<style scoped>
.vault-bulk-bar{display:flex;align-items:center;gap:7px;padding:8px 12px;border-bottom:1px solid #dce8e0;background:#f1f8f4;color:var(--pc-primary);font-size:9px}.vault-bulk-bar b{margin-right:auto}.vault-bulk-bar button{padding:5px 7px;border:1px solid var(--pc-border);border-radius:6px;background:#fff;cursor:pointer}.vault-bulk-bar .danger-text{border-color:#e2bcbc;color:#a43f3f}.vault-list>button.bulk-selected{box-shadow:inset 3px 0 var(--pc-primary);background:#e6f2ea}.vault-context-scrim{position:fixed;z-index:1999;inset:0}
.vault-cloud-history{width:min(520px,calc(100vw - 40px));overflow:hidden;border:1px solid var(--pc-border);border-radius:14px;background:#fff;box-shadow:0 26px 80px #102c1d40}.vault-cloud-history header,.vault-cloud-history footer,.vault-cloud-history-list article{display:flex;align-items:center;justify-content:space-between;gap:14px}.vault-cloud-history header{padding:18px 20px;border-bottom:1px solid var(--pc-border)}.vault-cloud-history h2,.vault-cloud-history p{margin:0}.vault-cloud-history header small{color:var(--pc-primary);font-size:8px;letter-spacing:1px}.vault-cloud-history header p,.vault-cloud-history-list small,.vault-cloud-history footer{color:var(--pc-muted);font-size:9px}.vault-cloud-history header>button{border:0;background:transparent;font-size:20px}.vault-cloud-history-list{display:grid;max-height:420px;overflow:auto;padding:8px 20px}.vault-cloud-history-list>p{padding:20px 0;text-align:center;color:var(--pc-muted)}.vault-cloud-history-list article{padding:11px 0;border-bottom:1px solid #edf1ee}.vault-cloud-history-list article span{display:grid;gap:3px}.vault-cloud-history-list button,.vault-cloud-history footer button{padding:7px 10px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:var(--pc-primary)}.vault-cloud-history footer{padding:13px 20px;border-top:1px solid var(--pc-border)}
.vault-history-import{display:grid;width:min(660px,calc(100vw - 40px));max-height:calc(100vh - 48px);overflow:auto;border:1px solid var(--pc-border);border-radius:15px;background:#fff;box-shadow:0 26px 80px #102c1d40}.vault-history-import>header{display:flex;justify-content:space-between;gap:20px;padding:20px 22px 16px;border-bottom:1px solid var(--pc-border);background:linear-gradient(135deg,#f3f9f5,#fff)}.vault-history-import h2,.vault-history-import p{margin:0}.vault-history-import header small{color:#6f4cad;font-size:8px;font-weight:750;letter-spacing:1px}.vault-history-import header h2{margin:4px 0;font-size:17px}.vault-history-import header p{color:var(--pc-muted);font-size:9px}.vault-history-import header>button{width:28px;height:28px;border:0;border-radius:7px;background:transparent;font-size:20px}.vault-import-source{display:flex;gap:8px;padding:17px 22px}.vault-import-source label,.vault-import-source button{padding:9px 12px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;color:var(--pc-primary);font-size:9px;cursor:pointer}.vault-import-source label{border-color:var(--pc-primary);background:var(--pc-primary);color:#fff}.vault-import-source input{display:none}.vault-import-summary{display:grid;grid-template-columns:2fr repeat(3,1fr);margin:0 22px 14px;border:1px solid var(--pc-border);border-radius:9px}.vault-import-summary span{display:grid;gap:4px;padding:10px 12px;border-right:1px solid var(--pc-border)}.vault-import-summary span:last-child{border:0}.vault-import-summary small{color:var(--pc-muted);font-size:7px}.vault-import-summary strong{overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.vault-import-default-scope{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 22px 12px;padding:11px 12px;border:1px solid var(--pc-border);border-radius:9px;background:#fafcfb}.vault-import-default-scope label{display:grid;gap:5px;color:var(--pc-muted);font-size:8px}.vault-import-default-scope select{min-width:0;padding:7px 9px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:var(--pc-text)}.vault-import-default-scope>small{grid-column:1/-1;color:var(--pc-muted);font-size:7px}.vault-import-policy{display:flex;align-items:center;justify-content:space-between;margin:0 22px 12px;color:var(--pc-muted);font-size:9px}.vault-import-policy select{padding:7px 9px;border:1px solid var(--pc-border);border-radius:7px;background:#fff}.vault-import-preview,.vault-import-errors{display:grid;margin:0 22px 12px;border:1px solid var(--pc-border);border-radius:9px}.vault-import-preview article{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 11px;border-bottom:1px solid #edf1ee}.vault-import-preview article span{display:grid;gap:3px}.vault-import-preview small,.vault-import-preview p{color:var(--pc-muted);font-size:7px}.vault-import-preview em{color:var(--pc-primary);font-size:7px;font-style:normal}.vault-import-preview p{padding:8px 11px}.vault-import-errors{gap:4px;padding:10px 12px;border-color:#efd7d7;background:#fffafa;color:#9a5252;font-size:8px}.vault-import-message,.vault-import-warning{margin:0 22px 12px!important;padding:9px 11px;border-radius:8px;background:#f1f8f4;color:#356247;font-size:8px}.vault-import-warning{background:#fff8e8;color:#84652d}.vault-history-import>footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px 18px;border-top:1px solid var(--pc-border)}.vault-history-import>footer button{padding:8px 12px;border:1px solid var(--pc-border);border-radius:8px;background:#fff}.vault-history-import>footer .primary-action{border-color:var(--pc-primary);background:var(--pc-primary);color:#fff}@media(max-width:650px){.vault-import-summary{grid-template-columns:1fr 1fr}.vault-import-default-scope{grid-template-columns:1fr}.vault-import-source,.vault-import-policy{align-items:stretch;flex-direction:column}}
@media(max-width:1079px){
.community-responsive .vault-prototype .vault-workspace,.community-responsive .vault-prototype .vault-workspace.vault-edit-layout{grid-template-columns:minmax(0,1fr);height:auto;min-width:0;overflow:visible;gap:10px}
.community-responsive .vault-prototype .vault-list{position:static;grid-row:auto;width:100%;height:auto;max-height:300px;overflow:auto}
.community-responsive .vault-prototype .vault-edit-layout>.vault-list{display:none}
.community-responsive .vault-prototype .vault-detail,.community-responsive .vault-prototype .vault-side-panel{grid-column:1;min-width:0;width:100%;overflow:visible}
.community-responsive .vault-prototype .vault-basic-grid,.community-responsive .vault-prototype .vault-secret-grid{grid-template-columns:minmax(0,1fr)}
.community-responsive .vault-prototype .vault-detail-head,.community-responsive .vault-prototype .vault-toolbar,.community-responsive .vault-prototype .vault-form-actions{flex-wrap:wrap;gap:8px}
.community-responsive .vault-prototype .vault-detail input,.community-responsive .vault-prototype .vault-detail textarea{max-width:100%;min-width:0}
.community-responsive .vault-prototype .vault-form-actions button{min-height:44px}
}
</style>
