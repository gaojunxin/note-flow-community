<script setup lang="ts">
import {startKnowledgeImportBackground} from './services/knowledgeStartup'
import {installNativeFileInputs} from './services/nativeFileInputs'
import {invoke} from '@tauri-apps/api/core'
import {createTaskReminderActivation} from './services/taskReminderActivation'
import {startBackgroundRefresh} from './services/backgroundRefresh'
import AppLockGuard from './components/AppLockGuard.vue'
import {sessionRecovery} from './services/sessionRecovery'
import {appLock} from './services/appLock'
import {isDesktopClient} from './services/serverConfig'
import {registerLocalDraftGuard} from './services/localDraftLifecycle'
import {knowledgeAvailable,isCommunityEdition} from './services/clientCapabilities'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { navigation, preloadNavigation } from './router'
import { useAuthStore } from './stores/auth'
import { useNotesStore } from './stores/notes'
import AreaManager from './components/AreaManager.vue'
import {activeAreas} from './services/areaManagement'
import NotificationPanel from './components/NotificationPanel.vue'
import { useNotificationsStore, type PcNotification } from './stores/notifications'
import { repairMojibake } from './utils/textEncoding'
import { workspaceService, type AreaEntity, type ProjectEntity } from './services/workspace'
import {syncRuntimeIssues} from './services/syncRuntimeIssues'
import { shouldSyncWorkspace } from './services/syncReadiness'
import { createPcSyncEvents, syncDelivery } from './services/syncEvents'
import { clearDesktopTaskReminders,reconcileDesktopTaskReminders } from './services/taskReminders'
import { tasksService,localAiTasks } from './services/tasks'
import { scopedPreferenceKey } from './services/clientContext'
import { activeProfileId,syncAvailable } from './services/profiles'
import {accountLifecycleRevision} from './services/accountStorage'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import ProductDialog from './components/ProductDialog.vue'
import ContextMenuHost from './components/ContextMenuHost.vue'
import ProjectListPanel from './components/ProjectListPanel.vue'
import ProjectNavigationShell from './components/ProjectNavigationShell.vue'
import { measureInteractionAfterPaint } from './services/performanceCapture'
import {pcSyncResetEvents,pcSyncResetPaused,runPcSyncGuarded} from './services/syncResetGuard'
import { createCanvasService } from './services/canvases'
import { logsViewCache } from './services/logsViewCache'
import { globalAreaUid } from './services/globalAreaScope'
import { selectGlobalCreateFiles, stageGlobalCreateFiles } from './services/globalCreate'
import {reconcileDeletedAttachments,hasPendingNoteAttachments} from './services/attachments'
import {syncPendingNoteAttachments} from './services/pendingNoteAttachmentSync'
import {syncActivity,trackSyncCheck} from './services/syncActivity'

const sidebarCollapsed = ref(false)
const mobileNavigationOpen = ref(false)
const commonNavigationPaths = new Set<string>(['/home','/notes','/logs','/tasks','/projects','/canvas','/vault'])
const primaryNavigation = navigation.filter(item=>commonNavigationPaths.has(item.path))
const moreNavigation = navigation.filter(item=>!commonNavigationPaths.has(item.path))
const moreNavigationExpanded = ref(false)
function toggleMoreNavigation(){
  moreNavigationExpanded.value=!moreNavigationExpanded.value
}
const route = useRoute()
const router = useRouter()
watch(()=>route.path,path=>{
  if(moreNavigation.some(item=>path===item.path||path.startsWith(item.path+'/')))moreNavigationExpanded.value=true
},{immediate:true})
watch(() => route.fullPath, () => { mobileNavigationOpen.value = false })
const removeNavigationGuard = isCommunityEdition ? registerLocalDraftGuard(mobileNavigationOpen, {flush:async()=>{},dismiss:()=>{if(!mobileNavigationOpen.value)return false;mobileNavigationOpen.value=false;return true}}) : undefined
onBeforeUnmount(()=>removeNavigationGuard?.())
const auth = useAuthStore()
const notes = useNotesStore()
const notifications = useNotificationsStore()
let lockReminderRequest=0
watch(appLock.enabled,(enabled,previous)=>{
 if(!isDesktopClient()||!enabled&&previous!==true)return
 const request=++lockReminderRequest,owner=activeProfileId('local'),revision=accountLifecycleRevision(),current=()=>request===lockReminderRequest&&owner===activeProfileId('local')&&revision===accountLifecycleRevision()
 void (async()=>{await clearDesktopTaskReminders(owner);if(!current())return;const tasks=await localAiTasks();if(current())await reconcileDesktopTaskReminders(tasks,{requestPermission:false})})().catch(()=>{})
},{immediate:true})
const syncEvents = createPcSyncEvents(async force => runPcSyncGuarded(async () => {
  void notifications.refreshRemote()
  if(force)await reconcileDeletedAttachments()
  if(!force && !await shouldSyncWorkspace(String(auth.user?.userId||'')) && !await hasPendingNoteAttachments(String(auth.user?.userId||''))){if(!notes.syncError&&(notes.syncPhase==='error'||notes.syncPhase==='offline'))notes.syncPhase='idle';return !notes.syncError}
  let success=true
  await trackSyncCheck('同步工作区内容',async()=>{
    for(const sync of [()=>notes.runSync({background:true,force:Boolean(force)}),async()=>{
      const owner=String(auth.user?.userId||''),revision=accountLifecycleRevision()
      if(!owner||notes.syncPhase==='error'||notes.syncPhase==='offline')return
      const result=await syncPendingNoteAttachments(owner)
      if(revision!==accountLifecycleRevision()||owner!==String(auth.user?.userId||''))throw Error('账号或空间已切换，已停止附件同步')
      if(result.failed)success=false
      // 上传成功仅代表本机引用已写回；继续发送新操作，不能提前宣称远端已确认。
      if(result.uploaded)await notes.runSync({background:true,force:true})
    },()=>tasksService.sync(),()=>workspaceService.sync(),()=>createCanvasService(String(auth.user?.userId||'local')).sync()]){
      if(pcSyncResetPaused())return
      try{await sync()}catch(source){success=false;console.warn('自动同步未完成',source)}
    }
  })
  if(notes.syncPhase==='error')success=false
  if(!pcSyncResetPaused())window.dispatchEvent(new Event('note-flow:workspace-change'))
  return success
}))
const publicPage = computed(() => Boolean(route.meta.public))
const settingsPage = computed(() => route.path === '/settings')
const projectPage = computed(() => route.path.startsWith('/projects'))
const searchPage = computed(() => route.path === '/search')
const searchQuery = ref('')
const globalSearchInput=ref<HTMLInputElement>()
let stopKnowledgeImports:undefined|(()=>void)
const online = ref(navigator.onLine)
const createMenuOpen = ref(false)
const createMenu = ref<HTMLElement | null>(null)
const notificationOpen = ref(false)
const notificationMenu = ref<HTMLElement | null>(null)
const accountOpen = ref(false)
const accountMenu = ref<HTMLElement | null>(null)
const areaOpen = ref(false)
const areaManagerOpen = ref(false)
const areaManagerCreate = ref(false)
const areaMenu = ref<HTMLElement | null>(null)
const areaQuery = ref('')
let unlistenReminderActivation: UnlistenFn | undefined
let unlistenReminderErrors: UnlistenFn | undefined
let unlistenTrayNavigation: UnlistenFn | undefined
let startupTimer: number | undefined
const displayName = computed(() => {
  const candidates = [auth.user?.nickName, auth.user?.userName]
  const value = candidates.find(item => typeof item === 'string' && item.trim() && !item.includes('\uFFFD'))
  return value ? repairMojibake(value) : '迹语用户'
})
const avatarText = computed(() => Array.from(displayName.value)[0] || 'N')
const avatarUrl = computed(() => auth.user?.avatar?.trim() || '')
const syncEnabled = ref(localStorage.getItem('note-flow-pc-sync-enabled') !== 'false')
const areas = ref<AreaEntity[]>([]), sidebarProjects = ref<ProjectEntity[]>([])
const areaPreferenceKey = () => scopedPreferenceKey('note-flow-current-area', auth.user?.userId || 'anonymous')
const currentAreaUid = globalAreaUid
currentAreaUid.value = localStorage.getItem(areaPreferenceKey()) || ''
const currentArea = computed(() => areas.value.find(item => item.uid === currentAreaUid.value))
const visibleAreas = computed(() => { const query = areaQuery.value.trim().toLocaleLowerCase(); return query ? activeAreas(areas.value).filter(item => item.name.toLocaleLowerCase().includes(query)) : activeAreas(areas.value) })
const selectedProjectAreaName = computed(() => {
  const projectUid=typeof route.params.projectUid==='string'?route.params.projectUid:''
  const areaUid=sidebarProjects.value.find(item=>item.uid===projectUid)?.areaUid
  return areas.value.find(item=>item.uid===areaUid)?.name
})
const createContextProject = computed(() => {
  const uid=typeof route.params.projectUid==='string'?route.params.projectUid:''
  return uid?sidebarProjects.value.find(item=>item.uid===uid):undefined
})
const createContextArea = computed(() => areas.value.find(item=>item.uid===(createContextProject.value?.areaUid||currentAreaUid.value)))
const createContextLabel = computed(() => createContextProject.value
  ? `${createContextArea.value?.name||'未指定领域'} · ${createContextProject.value.name}`
  : createContextArea.value?.name||'待数据治理归类')
const syncState = computed(() => {
  if (!syncAvailable()) return { label: '仅保存在本机', tone: 'muted' }
  if (!online.value) return { label: '当前离线', tone: 'offline' }
  if (!syncEnabled.value) return { label: '同步已关闭', tone: 'muted' }
  if(syncActivity.running)return {label:'同步中 · 点击查看详情',tone:'active'}
  if (syncRuntimeIssues({deliveryError:syncDelivery.error,notePhase:notes.syncPhase,noteError:notes.syncError}).length) return { label: notes.syncPhase === 'conflict' ? '存在同步冲突' : '同步异常', tone: 'error' }
  return { label: '已同步 · 点击查看详情', tone: 'ok' }
})

function openSearch() {
  const target={path:'/search',query:searchQuery.value.trim()?{q:searchQuery.value.trim()}:{} }
  if(searchPage.value){void router.replace(target);return}
  void router.push(target)
}
function updateSearch(){if(searchPage.value)void router.replace({path:'/search',query:searchQuery.value.trim()?{q:searchQuery.value.trim()}:{}})}
function focusGlobalSearch(){window.requestAnimationFrame(()=>{globalSearchInput.value?.focus();globalSearchInput.value?.select()})}
function clearSearch(){searchQuery.value='';updateSearch();window.requestAnimationFrame(()=>globalSearchInput.value?.focus())}
function interactionRequestId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` }
function createScopeQuery() { return { ...(createContextArea.value?.uid?{areaUid:createContextArea.value.uid}:{}), ...(createContextProject.value?.uid?{projectUid:createContextProject.value.uid}:{}) } }
function createNote() { router.push({ path: '/notes', query: { create: '1', request: interactionRequestId(), ...createScopeQuery() } }) }
function createTask() { router.push({ path: '/tasks', query: { create: '1', request: interactionRequestId(), ...createScopeQuery() } }) }
function createProject() { router.push({ path: '/projects', query: { create: '1', request: interactionRequestId() } }) }
async function importFiles(){const files=await selectGlobalCreateFiles();if(!files.length)return;stageGlobalCreateFiles(files);await router.push({path:'/notes',query:{import:'file',request:interactionRequestId(),...createScopeQuery()}})}
function chooseCreate(target: 'note' | 'task' | 'log' | 'file' | 'project') {
  createMenuOpen.value = false
  if (target === 'note') createNote()
  else if (target === 'task') createTask()
  else if (target === 'project') createProject()
  else if (target === 'file') void importFiles()
  else router.push({path:'/logs',query:{focus:'progress',request:interactionRequestId(),...createScopeQuery()}})
}
function shortcuts(event: KeyboardEvent) {
  if(appLock.locked.value)return
  if(event.key==='Escape'&&mobileNavigationOpen.value){mobileNavigationOpen.value=false;event.preventDefault();return}
  if (event.key === 'Escape') {
    createMenuOpen.value = false; notificationOpen.value = false; accountOpen.value = false; areaOpen.value = false
    if(searchPage.value&&searchQuery.value){event.preventDefault();event.stopImmediatePropagation();clearSearch()}
    return
  }
  if (!(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() === 'k' && event.shiftKey) { event.preventDefault(); router.push('/vault'); return }
  if (event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); focusGlobalSearch() }
  if (event.key.toLowerCase() === 'n') { event.preventDefault(); createNote() }
}
function updateOnline() { online.value = navigator.onLine }
function updateSyncPreference() { syncEnabled.value = localStorage.getItem('note-flow-pc-sync-enabled') !== 'false' }
function pauseSyncForReset(){syncEvents.stop()}
function resumeSyncAfterReset(){if(auth.user&&syncEnabled.value&&syncAvailable())syncEvents.start()}
function toggleAccount() {
  if (!accountOpen.value) measureInteractionAfterPaint('account_menu_open')
  areaOpen.value = false
  accountOpen.value = !accountOpen.value
}
function toggleArea() { accountOpen.value = false; areaOpen.value = !areaOpen.value;if(areaOpen.value){areaQuery.value='';void nextTick(()=>areaMenu.value?.querySelector('input')?.focus())} }
function manageAreas(create=false){areaOpen.value=false;areaManagerCreate.value=create;areaManagerOpen.value=true}
function areaKeys(event:KeyboardEvent){
 if(event.key==='Escape'){areaOpen.value=false;event.stopPropagation();return}
 if(!['ArrowDown','ArrowUp'].includes(event.key))return
 const options=Array.from(areaMenu.value?.querySelectorAll<HTMLButtonElement>('[data-area-option]')||[]);if(!options.length)return
 const index=options.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='ArrowDown'?(index+1)%options.length:(index<=0?options.length-1:index-1)
 event.preventDefault();options[next]?.focus()
}
function closeFloatingMenus(event: PointerEvent) { if (!createMenu.value?.contains(event.target as Node)) createMenuOpen.value = false; if (!notificationMenu.value?.contains(event.target as Node)) notificationOpen.value = false; if (!accountMenu.value?.contains(event.target as Node)) accountOpen.value = false; if (!areaMenu.value?.contains(event.target as Node)) areaOpen.value = false }
watch(appLock.locked,locked=>{if(locked){createMenuOpen.value=false;notificationOpen.value=false;accountOpen.value=false;areaOpen.value=false}})
function selectArea(uid: string) { currentAreaUid.value = uid; areaOpen.value = false }
function areasManaged(){void loadWorkspaceNavigation();window.dispatchEvent(new Event('note-flow:workspace-change'))}
async function toggleNotifications() { notificationOpen.value = !notificationOpen.value; if (notificationOpen.value) await notifications.refreshTaskAlerts() }
function openNotification(item: PcNotification) { notifications.markRead(item.id); if(item.kind!=='notice'&&(!item.targetState||item.targetState==='active')){notificationOpen.value = false; router.push({ path: item.target, query: item.query })} }
async function loadWorkspaceNavigation(){
  const [areaResult,projectResult]=await Promise.allSettled([workspaceService.areas(),workspaceService.projects(undefined,true)])
  if(pcSyncResetPaused())return
  if(areaResult.status==='fulfilled'){
    areas.value=areaResult.value
    // Empty uid is the explicit “all areas” selection, not a missing area.
    if(currentAreaUid.value&&!activeAreas(areas.value).some(item=>item.uid===currentAreaUid.value))currentAreaUid.value=''
  }
  if(projectResult.status==='fulfilled')sidebarProjects.value=projectResult.value
}
function openProject(uid:string){router.push(`/projects/${uid}/tasks`)}
function workspaceChanged(){if(pcSyncResetPaused())return;notes.invalidate();void loadWorkspaceNavigation()}
let stopNotificationRefresh:(()=>void)|undefined
const reminderActivation=createTaskReminderActivation({
 take:()=>invoke('take_task_reminder_activation'),ready:()=>!publicPage.value&&!appLock.locked.value,
 owner:()=>activeProfileId('local'),revision:accountLifecycleRevision,
 unavailable:message=>notifications.add({kind:'notice',title:'任务提醒',message,target:'/tasks',dedupeKey:'task-reminder-activation'}),
 async open(uid,current){const tasks=await tasksService.list();if(!current())return;const task=tasks.find(item=>item.uid===uid&&!item.deleted);if(!task){notifications.add({kind:'notice',title:'任务提醒已失效',message:'任务已删除或当前本机尚未同步到该任务，请在任务页检查。',target:'/tasks',dedupeKey:'task-reminder-missing'});return}await router.push({path:'/tasks',query:{task:uid,source:'reminder',activation:crypto.randomUUID()}})}
})
watch(()=>[appLock.locked.value,publicPage.value,auth.user?.userId],()=>{if(isDesktopClient())void reminderActivation.drain().catch(()=>undefined)})
function retryReminderActivation(){if(isDesktopClient())void reminderActivation.drain().catch(()=>undefined)}
function resetNotificationCenter(){notifications.clear()}
async function refreshNotificationCenter(){notifications.load();await notifications.refreshRemote()}
onMounted(() => { if(knowledgeAvailable)stopKnowledgeImports=startKnowledgeImportBackground(()=>String(auth.user?.userId||'local'));window.addEventListener('note-flow:workspace-change',retryReminderActivation);if(isDesktopClient()){void listen('note-flow-reminder-activated',()=>{void reminderActivation.drain().catch(()=>undefined)}).then(handle=>{unlistenReminderActivation=handle;return reminderActivation.drain()}).catch(()=>undefined);void listen<string>('note-flow-reminder-delivery-error',event=>notifications.add({kind:'notice',title:'系统提醒发送失败',message:event.payload,target:'/tasks',dedupeKey:'task-reminder-delivery'})).then(handle=>unlistenReminderErrors=handle).catch(()=>undefined)} stopNotificationRefresh=startBackgroundRefresh(refreshNotificationCenter,{window,document});window.addEventListener('note-flow:account-data-reset',resetNotificationCenter);notifications.load();startupTimer=window.setTimeout(async()=>{await loadWorkspaceNavigation();await notifications.refreshTaskAlerts();if(auth.user&&syncEnabled.value&&syncAvailable())syncEvents.start()},300);void listen<string>('note-flow-tray-navigate',event=>{if(!appLock.locked.value)void router.push(event.payload)}).then(value=>unlistenTrayNavigation=value).catch(()=>undefined); window.addEventListener('keydown', shortcuts); window.addEventListener('pointerdown', closeFloatingMenus); window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline); window.addEventListener('storage', updateSyncPreference); window.addEventListener('note-flow:sync-preference', updateSyncPreference);window.addEventListener('note-flow:workspace-change',workspaceChanged);window.addEventListener(pcSyncResetEvents.pause,pauseSyncForReset);window.addEventListener(pcSyncResetEvents.resume,resumeSyncAfterReset) })
onBeforeUnmount(() => { stopKnowledgeImports?.();window.removeEventListener('note-flow:workspace-change',retryReminderActivation);reminderActivation.stop();unlistenReminderActivation?.();unlistenReminderErrors?.();stopNotificationRefresh?.();window.removeEventListener('note-flow:account-data-reset',resetNotificationCenter);syncEvents.stop();if(startupTimer!==undefined)window.clearTimeout(startupTimer);unlistenTrayNavigation?.();window.removeEventListener('keydown', shortcuts); window.removeEventListener('pointerdown', closeFloatingMenus); window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); window.removeEventListener('storage', updateSyncPreference); window.removeEventListener('note-flow:sync-preference', updateSyncPreference);window.removeEventListener('note-flow:workspace-change',workspaceChanged);window.removeEventListener(pcSyncResetEvents.pause,pauseSyncForReset);window.removeEventListener(pcSyncResetEvents.resume,resumeSyncAfterReset) })
watch(() => route.fullPath, path => {
  if (!publicPage.value && !settingsPage.value) sessionStorage.setItem('note-flow-pc-last-workspace', path)
}, { immediate: true })
watch(()=>route.query.q,value=>{if(searchPage.value)searchQuery.value=typeof value==='string'?value:''},{immediate:true})
watch(()=>route.path,(path,previous)=>{if(previous==='/search'&&path!=='/search')searchQuery.value=''})
watch([() => notes.syncPhase, () => notes.syncError], ([phase,error]) => { if(phase==='conflict')notifications.add({kind:'sync',title:'发现同步冲突',message:'有内容需要选择保留版本',target:'/settings',dedupeKey:`conflict:${notes.conflicts.length}`});else if(phase==='error')notifications.add({kind:'sync',title:'同步暂未完成',message:error||'请检查网络与同步设置',target:'/settings',dedupeKey:`sync-error:${error||'connection'}:${new Date().toISOString().slice(0,13)}`}) })
watch([() => auth.user?.userId, () => syncEnabled.value, () => sessionRecovery.required], ([user, enabled, expired]) => { if (user && enabled && !expired && syncAvailable()) syncEvents.start(); else syncEvents.stop() })
watch(() => auth.user?.userId, user => { notifications.load();void notifications.refreshRemote();if (!user) return; currentAreaUid.value=localStorage.getItem(areaPreferenceKey())||'';void loadWorkspaceNavigation() })
watch(currentAreaUid,value=>{
  localStorage.setItem(areaPreferenceKey(),value)
  notes.invalidate()
  logsViewCache.projects=[]
  logsViewCache.oldLogs=[]
  logsViewCache.loadedAt=0
  window.dispatchEvent(new CustomEvent('note-flow:area-change',{detail:value}))
})

async function logout() {
  await clearDesktopTaskReminders()
  await auth.logout()
  accountOpen.value = false
  syncEnabled.value = false
  localStorage.setItem('note-flow-pc-sync-enabled','false')
  syncEvents.stop()
  await router.replace('/home')
}

onBeforeUnmount(installNativeFileInputs())
</script>

<template>
  <AppLockGuard/>
  <div class="app-lock-content" v-show="!appLock.locked.value" :inert="appLock.locked.value?true:undefined" :aria-hidden="appLock.locked.value?true:undefined">
  <RouterView v-if="publicPage" />
  <div v-else class="pc-app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'community-responsive': isCommunityEdition, 'mobile-navigation-open': mobileNavigationOpen }">
    <button v-if="isCommunityEdition&&mobileNavigationOpen" class="mobile-navigation-backdrop" aria-label="关闭导航" @click="mobileNavigationOpen=false"/>
    <aside class="pc-sidebar" @keydown.esc="mobileNavigationOpen=false">
      <button v-if="isCommunityEdition" class="mobile-only mobile-navigation-close" aria-label="关闭导航" @click="mobileNavigationOpen=false">×</button>
      <div class="pc-sidebar-brand"><img src="/ji-yu-icon.png" alt=""/><strong class="nav-label">迹语</strong><button class="sidebar-toggle pc-action pc-action--text" type="button" :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'" :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'" :aria-expanded="!sidebarCollapsed" aria-controls="pc-sidebar-navigation" @click="sidebarCollapsed = !sidebarCollapsed"><svg class="sidebar-toggle-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path :d="sidebarCollapsed?'m13 9 3 3-3 3':'m16 9-3 3 3 3'"/></svg></button></div>

      <nav id="pc-sidebar-navigation" aria-label="主导航">
        <RouterLink v-for="item in primaryNavigation" :key="item.path" :to="item.path" @pointerenter="preloadNavigation(item.path)" @focus="preloadNavigation(item.path)" @pointerdown="preloadNavigation(item.path)" @click="mobileNavigationOpen=false" :title="item.path==='/vault'?'保险箱 · Ctrl/⌘ Shift K':item.label">
          <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.icon"/></svg></span>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>
        <button class="nav-more-toggle pc-action pc-action--text" type="button" :aria-expanded="moreNavigationExpanded" aria-controls="sidebar-more-navigation" :aria-label="moreNavigationExpanded?'收起更多功能':'展开更多功能'" :title="moreNavigationExpanded?'收起更多功能':'展开更多功能'" @click="toggleMoreNavigation">
          <span class="nav-icon"><svg class="nav-group-chevron" viewBox="0 0 24 24" aria-hidden="true"><path :d="moreNavigationExpanded?'m6 10 6 6 6-6':'m10 6 6 6-6 6'"/></svg></span>
          <span class="nav-label">更多功能</span>
        </button>
        <div v-show="moreNavigationExpanded" id="sidebar-more-navigation" class="nav-more-items" role="group" aria-label="更多功能">
          <RouterLink v-for="item in moreNavigation" :key="item.path" :to="item.path" @pointerenter="preloadNavigation(item.path)" @focus="preloadNavigation(item.path)" @pointerdown="preloadNavigation(item.path)" @click="mobileNavigationOpen=false" :title="item.path==='/vault'?'保险箱 · Ctrl/⌘ Shift K':item.label">
            <span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.icon"/></svg></span>
            <span class="nav-label">{{ item.label }}</span>
          </RouterLink>
        </div>
      </nav>

    </aside>

    <main class="pc-workspace" :class="{'project-workspace':projectPage,'settings-workspace':settingsPage,'learning-workspace':route.path==='/learning','logs-workspace':route.path==='/logs'}">
      <div v-if="!online" class="network-banner" role="status">{{isCommunityEdition?'当前离线：内容仍可保存到本机。':'当前离线：笔记修改会保存在本机，恢复网络后可继续同步。'}}</div>
      <header class="pc-topbar" :class="{'search-mode':searchPage}">
        <button v-if="isCommunityEdition" class="mobile-only topbar-icon" aria-label="打开导航" :aria-expanded="mobileNavigationOpen" @click="mobileNavigationOpen=!mobileNavigationOpen">☰</button>
        <div v-if="projectPage" id="project-switcher-anchor"/>
        <label class="global-search">
          <span>⌕</span>
          <input ref="globalSearchInput" v-model="searchQuery" :placeholder="knowledgeAvailable?'搜索知识、笔记和任务…':'搜索笔记和任务…'" @input="updateSearch" @keyup.enter="openSearch" />
          <button v-if="searchQuery" class="global-search-clear" type="button" title="清空搜索" aria-label="清空搜索" @click="clearSearch">×</button>
          <kbd>Ctrl/⌘ K</kbd>
        </label>
        <button v-if="sessionRecovery.required&&auth.token&&!isCommunityEdition" class="session-recovery-action" type="button" title="本机修改已保留，重新登录后继续同步" @click="router.push({path:'/login',query:{connect:'1',redirect:route.fullPath}})">登录已过期 · 重新登录</button>
        <button v-else class="header-sync-state topbar-control" :class="syncState.tone" type="button" :title="syncState.label" :aria-label="syncState.label" @click="router.push({path:'/settings',query:{tab:'sync'}})"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 18.2H6a4 4 0 0 1-.6-7.95A6.5 6.5 0 0 1 18 8.5v.35a4.5 4.5 0 0 1 .1 8.98H16M9 16l3-3 3 3M12 13v8"/></svg><i /><span v-if="syncActivity.running" class="topbar-sync-label">同步中</span></button>
        <div ref="createMenu" class="global-create">
          <button class="global-create-trigger" type="button" title="全局新建" aria-label="打开全局新建菜单" :aria-expanded="createMenuOpen" @click="createMenuOpen = !createMenuOpen">＋</button>
          <div v-if="createMenuOpen" class="global-create-menu">
            <button type="button" @click="chooseCreate('note')"><span>▤</span><b>新建笔记</b><small>Ctrl/⌘ N</small></button>
            <button type="button" @click="chooseCreate('task')"><span>✓</span><b>新建任务</b></button>
            <button type="button" @click="chooseCreate('log')"><span>▣</span><b>记录日志</b></button>
            <button type="button" @click="chooseCreate('file')"><span>↥</span><b>导入文件</b><small>文件笔记</small></button>
            <div class="global-create-separator" />
            <button type="button" @click="chooseCreate('project')"><span>□</span><b>新建项目</b></button>
            <footer>保存到：<strong>{{createContextLabel}}</strong></footer>
          </div>
        </div>
        <div ref="notificationMenu" class="notification-center">
          <button class="topbar-icon notification-trigger" type="button" aria-label="通知中心" :aria-expanded="notificationOpen" @click="toggleNotifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><i v-if="notifications.unread">{{notifications.unread>99?'99+':notifications.unread}}</i></button>
          <NotificationPanel v-if="notificationOpen" :notifications="notifications" @open="openNotification"/>
        </div>
        <div ref="areaMenu" class="sidebar-area-wrap topbar-area-wrap">
          <button class="sidebar-area-trigger topbar-area-trigger" type="button" :aria-expanded="areaOpen" aria-haspopup="dialog" aria-label="切换当前领域" @click.stop="toggleArea"><i :style="{background:currentArea?.color||'#6f8378'}"/><span>{{currentArea?.name||'全部领域'}}</span><b>⌄</b></button>
          <section v-if="areaOpen" class="area-menu" role="dialog" aria-label="切换领域" @keydown="areaKeys">
            <header><div><strong>切换领域</strong><small>选择你此刻关注的空间</small></div><span>{{activeAreas(areas).length}} 个领域</span></header>
            <label class="area-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input v-model="areaQuery" aria-label="搜索领域" placeholder="搜索领域…"/><button v-if="areaQuery" type="button" aria-label="清空领域搜索" @click="areaQuery=''">×</button></label>
            <button type="button" data-area-option class="area-option area-everything" :class="{active:!currentAreaUid}" :aria-pressed="!currentAreaUid" @click="selectArea('')"><i class="area-all"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg></i><span><b>全部领域</b><small>跨领域查看所有内容</small></span><em v-if="!currentAreaUid">✓</em></button>
            <div class="area-group-label">我的领域<span>{{visibleAreas.length}}</span></div>
            <div class="area-options"><button v-for="area in visibleAreas" :key="area.uid" type="button" data-area-option class="area-option" :class="{active:currentAreaUid===area.uid}" :aria-pressed="currentAreaUid===area.uid" @click="selectArea(area.uid)"><i class="area-avatar" :style="{color:area.color||'#299365',background:(area.color||'#299365')+'16'}">{{area.name.slice(0,1)}}</i><span><b>{{area.name}}</b><small>{{sidebarProjects.filter(item=>item.areaUid===area.uid&&!['completed','archived'].includes(item.status)).length}} 个进行中项目</small></span><em v-if="currentAreaUid===area.uid">✓</em></button><div v-if="!visibleAreas.length" class="area-switch-empty"><strong>{{areaQuery?'没有匹配的领域':'还没有使用中的领域'}}</strong><small>{{areaQuery?'换个关键词试试':'新建领域，或在管理中恢复已归档领域'}}</small></div></div>
            <footer><button type="button" @click="manageAreas(true)"><span aria-hidden="true">＋</span>新建领域</button><button type="button" @click="manageAreas()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6"/></svg>管理领域</button></footer>
          </section>
        </div>
        <div ref="accountMenu" class="pc-account topbar-account">
          <button class="pc-user" type="button" :title="displayName" :aria-expanded="accountOpen" @click.stop="toggleAccount"><img v-if="avatarUrl" :src="avatarUrl" alt="" decoding="async"/><span v-else aria-hidden="true">{{avatarText}}</span></button>
          <section v-show="accountOpen" class="account-menu" :aria-hidden="!accountOpen" :inert="accountOpen?undefined:true"><header><img v-if="avatarUrl" :src="avatarUrl" alt="" decoding="async"/><span v-else>{{avatarText}}</span><div><strong>{{displayName}}</strong><small>{{auth.user?.userName}}</small></div></header><div class="account-sync-summary" :class="syncState.tone"><i/>{{syncState.label}}</div><button type="button" @click="accountOpen=false;router.push('/settings')"><span>⚙</span><b>设置</b></button><button v-if="appLock.enabled.value" type="button" title="锁定软件 · Ctrl/⌘ Shift L" @click="accountOpen=false;appLock.lock()"><span>🔒</span><b>锁定软件</b></button><button v-if="!isCommunityEdition" class="account-logout" type="button" @click="logout"><span>↪</span><b>退出登录</b></button></section>
        </div>
      </header>
      <ProjectNavigationShell v-if="projectPage" :owner-id="String(auth.user?.userId||'anonymous')" :project-name="createContextProject?.name" :selected-uid="String(route.params.projectUid||'')" :dismiss-key="route.fullPath" toolbar-target="#project-switcher-anchor">
        <template #list="{collapse}">
        <ProjectListPanel :area-uid="currentAreaUid" :area-name="currentArea?.name" :selected-area-name="selectedProjectAreaName" :projects="sidebarProjects" :selected-uid="typeof route.params.projectUid==='string'?route.params.projectUid:''" @create="()=>{collapse();createProject()}" @select="uid=>{openProject(uid);collapse()}" @collapse="collapse" @all="()=>{collapse();router.push('/projects')}" />
        </template>
        <RouterView />
      </ProjectNavigationShell>
      <RouterView v-else v-slot="{ Component }">
        <KeepAlive include="NotesWorkspaceView" :max="1">
          <component :is="Component" :key="route.path.startsWith('/notes')?'notes-workspace':`workspace-area:${currentAreaUid}`" />
        </KeepAlive>
      </RouterView>
    </main>
  </div>
  <AreaManager v-if="areaManagerOpen" :initial-area-uid="currentAreaUid" :start-create="areaManagerCreate" @close="areaManagerOpen=false" @changed="areasManaged" />
  <ProductDialog />
  <ContextMenuHost />
  </div>
</template>
<style scoped>
.app-lock-content{display:contents}
.header-sync-state:has(.topbar-sync-label){display:flex;align-items:center;gap:6px;width:auto;max-width:230px;padding:0 8px}.topbar-sync-label{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.header-sync-state:has(.topbar-sync-label)>i{right:2px}
</style>

<style scoped>.session-recovery-action{max-width:190px;flex-shrink:0;min-height:36px;padding:6px 10px;border:1px solid #e7bdb6;border-radius:8px;background:#fff4f1;color:#9a3020;font:inherit;font-size:12px;cursor:pointer}@media(max-width:720px){.session-recovery-action{max-width:130px;font-size:11px}}</style>
