import {Capacitor} from '@capacitor/core'
import {createApp} from 'vue'
import App from '../App.vue'
import {createPinia} from 'pinia'
import router from '../router'
import {getCommunityWorkspace} from './runtime'
import {useNotesStore} from '../stores/notes'
import {flushLocalDrafts,hasUnsavedLocalDrafts,dismissLocalDraftDialog} from '../services/localDraftLifecycle'
import {confirmDialog,productDialogState,settleProductDialog} from '../services/productDialog'
import {createCommunityBackHandler,closeCommunityMobile} from './backNavigation'
import {listenCommunityDesktopClose,closeCommunityDesktop} from './desktopLifecycle'
import '../styles/base.css'
import '../styles/toolHeaders.css'
import '../styles/tokens.css'
async function bootstrap() {
  await getCommunityWorkspace()
  const pinia=createPinia(),app=createApp(App).use(pinia)
  const flush=async()=>{await flushLocalDrafts();await useNotesStore(pinia).flushPendingSaves()}
  const report=(error:unknown)=>{void confirmDialog({title:'本地内容尚未保存',message:error instanceof Error?error.message:'保存失败，请返回编辑器重试。窗口保持打开。',confirmText:'返回编辑',cancelText:'留在当前页面',tone:'warning'})}
  router.beforeEach(async()=>{try{await flush();return true}catch(error){report(error);return false}})
  app.use(router).mount('#app')
  const back=createCommunityBackHandler({
    dismissDialog(){if(productDialogState.open){settleProductDialog(false);return true}return dismissLocalDraftDialog()},
    saveDraft:flush,
    navigateBack(){const previous=router.options.history.state.back;if(typeof previous==='string'&&previous){router.back();return true}if(router.currentRoute.value.path!=='/home'){void router.push('/home');return true}return false},
    close:closeCommunityMobile,
  })
  window.addEventListener('note-flow-community-back',()=>{void back().catch(report)})
  let closing:Promise<void>|undefined
  await listenCommunityDesktopClose(()=>{if(closing)return;closing=(async()=>{await flush();await closeCommunityDesktop()})().catch(report).finally(()=>{closing=undefined})})
  window.addEventListener('beforeunload',event=>{if(hasUnsavedLocalDrafts()||useNotesStore(pinia).hasPendingSaves()){event.preventDefault();event.returnValue=''}})
}
void bootstrap().catch(error => {console.error('Community initialization failed', error); const root=document.getElementById('app'); if(root) root.textContent='本地空间初始化失败，请重新打开。'})

if (import.meta.env.PROD && !Capacitor.isNativePlatform() && !(window as Window & {__TAURI_INTERNALS__?: unknown}).__TAURI_INTERNALS__ && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {void navigator.serviceWorker.register('/community-sw.js', {scope: '/community'}).catch(error => console.error('Community offline cache unavailable', error))})
}
