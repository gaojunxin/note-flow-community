import {knowledgeRoutes,knowledgeNavigationLoader} from './services/knowledgeRoutes'
import {createNavigationLoader, preloadNavigationCode} from './services/navigationPreload'
import {sessionRecovery} from './services/sessionRecovery'
import {isCommunityEdition,knowledgeAvailable} from './services/clientCapabilities'
import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { isDesktopClient } from './services/serverConfig'
import { legacyNotesReviewQuery, reviewQueryForLegacyPeriod } from './services/legacyReviewNavigation'
import ProjectsView from './views/ProjectsView.vue'
import ProjectLayout from './views/ProjectLayout.vue'

const LoginView = createNavigationLoader(() => import('./views/LoginView.vue'))
const HomeView = createNavigationLoader(() => import('./views/HomeView.vue'))
const NotesWorkspaceView = createNavigationLoader(() => import('./views/NotesWorkspaceView.vue'))
const LogsView = createNavigationLoader(() => import('./views/LogsView.vue'))
const GovernanceView = createNavigationLoader(() => import('./views/GovernanceView.vue'))
const TasksView = createNavigationLoader(() => import('./views/TasksView.vue'))
const RecordingsView = createNavigationLoader(() => import('./views/RecordingsView.vue'))
const SearchView = createNavigationLoader(() => import('./views/SearchView.vue'))
const FocusView = createNavigationLoader(() => import('./views/FocusView.vue'))
const FocusRecordsView = createNavigationLoader(() => import('./views/FocusRecordsView.vue'))
const ReviewView = createNavigationLoader(() => import('./views/ReviewView.vue'))
const SettingsView = createNavigationLoader(() => import('./views/SettingsView.vue'))
const VaultView = createNavigationLoader(() => import('./views/VaultView.vue'))
const AttachmentsView = createNavigationLoader(() => import('./views/AttachmentsView.vue'))
const AiLearningView = createNavigationLoader(() => import('./views/AiLearningView.vue'))
const CanvasView = createNavigationLoader(() => import('./views/CanvasView.vue'))

const navigationCode: Record<string, () => Promise<unknown>> = {
  '/home': HomeView, '/notes': NotesWorkspaceView, '/logs': LogsView,
  '/tasks': TasksView, '/knowledge': knowledgeNavigationLoader!, '/learning': AiLearningView,
  '/canvas': CanvasView, '/reviews': ReviewView, '/governance': GovernanceView,
  '/attachments': AttachmentsView, '/recordings': RecordingsView, '/vault': VaultView,
  '/focus': FocusView,
}
export function preloadNavigation(path: string) {
  preloadNavigationCode(navigationCode[path])
}

export const navigation = [
  { path: '/home', label: '首页', icon: 'M3.5 10.5 12 3l8.5 7.5v9H15v-6H9v6H3.5z' },
  { path: '/notes', label: '笔记', icon: 'M6 3.5h9l3 3v14H6zM15 3.5v3h3M9 11h6M9 15h6' },
  { path: '/logs', label: '日志', icon: 'M6 3.5h12v17H6zM9 8h6M9 12h6M9 16h4' },
  { path: '/tasks', label: '任务', icon: 'M8.5 6H20M8.5 12H20M8.5 18H20M3.5 6l1.2 1.2L7 4.8M3.5 12l1.2 1.2L7 10.8M3.5 18l1.2 1.2L7 16.8' },
  { path: '/projects', label: '项目', icon: 'M4 6h6l2 2h8v11H4zM4 10h16' },
  { path: '/knowledge', label: '知识', icon: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM8 4v16' },
  {path:'/learning',label:'AI 助手',icon:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'},
  { path: '/canvas', label: '画布', icon: 'M4 4h16v16H4zM8 15l3-4 3 3 2-2 2 3M8 8h.01' },
  { path: '/reviews', label: '回顾', icon: 'M4 19.5V13h4v6.5M10 19.5V8h4v11.5M16 19.5V4h4v15.5M3 19.5h18' },
  { path: '/governance', label: '数据治理', icon: 'M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z', toolStart: true },
  { path: '/attachments', label: '附件', icon: 'M8 12.5l5.8-5.8a3 3 0 0 1 4.2 4.2l-7.2 7.2a5 5 0 0 1-7.1-7.1l7-7' },
  { path: '/recordings', label: '录音', icon: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6' },
  { path: '/vault', label: '保险箱', icon: 'M6 10V7a6 6 0 0 1 12 0v3M5 10h14v10H5zM12 14v3' },
  { path: '/focus', label: '专注', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2' }
].filter(item=>knowledgeAvailable||item.path!=='/knowledge')

const router = createRouter({
  history: isCommunityEdition ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/home', component: HomeView, meta: { auth: true } },
    { path: '/learning', component: AiLearningView, meta: {auth:true} },
    { path: '/notes', component: NotesWorkspaceView, meta: { auth: true } },
    { path: '/logs', component: LogsView, meta: { auth: true } },
    ...knowledgeRoutes,
    { path: '/canvas', component: CanvasView, meta: { auth: true } },
    { path: '/governance', component: GovernanceView, meta: { auth: true } },
    { path: '/attachments', component: AttachmentsView, meta: { auth: true } },
    { path: '/tasks', component: TasksView, meta: { auth: true } },
    { path: '/calendar', redirect: to=>({path:'/home',query:{...to.query,calendar:'month'}}) },
    { path: '/recordings', component: RecordingsView, meta: { auth: true } },
    { path: '/focus', component: FocusView, meta: { auth: true } },
    { path: '/focus/records', component: FocusRecordsView, meta: { auth: true } },
    { path: '/reviews', component: ReviewView, meta: { auth: true } },
    { path: '/search', component: SearchView, meta: { auth: true } },
    { path: '/settings', component: SettingsView, meta: { auth: true } },
    { path: '/settings/users', redirect: to => ({path:'/settings',query:{...to.query,tab:'users'}}) },
    { path: '/settings/data-protection', redirect: to => ({path:'/settings',query:{...to.query,tab:'protection'}}) },
    { path: '/vault', component: VaultView, meta: { auth: true } },
    { path: '/projects', component: ProjectsView, meta: { auth: true } },
    { path: '/projects/:projectUid', component: ProjectLayout, meta: { auth: true }, children: [
      { path: '', redirect: to => `/projects/${String(to.params.projectUid)}/tasks` },
      { path: 'overview', redirect: to => `/projects/${String(to.params.projectUid)}/tasks` },
      { path: 'tasks', name: 'project-tasks', component: ProjectsView },
      { path: 'notes', name: 'project-notes', component: NotesWorkspaceView },
      { path: 'knowledge', redirect: '/knowledge' },
      { path: 'logs', name: 'project-logs', component: ProjectsView },
      { path: 'reviews', name: 'project-reviews', redirect: to => ({ path:'/reviews', query:{ scope:'project', project:String(to.params.projectUid) } }) },
      { path: 'reports', name: 'project-reports-legacy', redirect: to => ({ path:'/reviews', query:{ scope:'project', project:String(to.params.projectUid) } }) }
      ,{ path: 'credentials', redirect: '/vault' }
      ,{ path: 'reports/:seriesUid/:noteUid', name: 'project-report-editor', redirect: to => ({ path: '/reviews', query: reviewQueryForLegacyPeriod(to.query.period || 'daily', { ...to.query, projectUid: to.params.projectUid, seriesUid: to.params.seriesUid, noteUid: to.params.noteUid })! }) }
    ] },
    { path: '/:pathMatch(.*)*', redirect: '/home' }
  ]
})

router.beforeEach(async to => {
  // 社区旧链接不能重新打开服务器配置；保留其他查询参数并替换当前历史项。
  if(isCommunityEdition&&to.path==='/settings'&&['account','sync','users'].includes(String(to.query.tab)))return {path:'/settings',query:{...to.query,tab:'general'},replace:true}
  if(!knowledgeAvailable&&(to.path==='/knowledge'||to.path.startsWith('/knowledge/')||/^\/projects\/[^/]+\/knowledge(?:\/|$)/.test(to.path)))return '/home'
  if(isCommunityEdition&&to.path==='/settings/data-protection')return {path:'/settings',query:{tab:'data'}}
  const auth = useAuthStore()
  await auth.initialize()
  if (to.meta.auth && !auth.loggedIn) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.meta.admin && !auth.user?.roles?.includes('admin') && !auth.user?.permissions?.includes('*:*:*')) return '/settings'
  if (to.path === '/login' && auth.loggedIn && !sessionRecovery.required && !(isDesktopClient()&&to.query.connect==='1')) return '/home'
  if (to.path === '/notes') {
    const reviewQuery = legacyNotesReviewQuery(to.query)
    if (reviewQuery) return { path: '/reviews', query: reviewQuery }
  }
})

export default router
