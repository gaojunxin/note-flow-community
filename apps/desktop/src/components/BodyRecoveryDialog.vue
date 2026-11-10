<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref,computed} from 'vue'
import {useRoute} from 'vue-router'
import type {NoteEntity} from '@note-flow/core'
import {useNotesStore} from '../stores/notes'
import {useAuthStore} from '../stores/auth'
import {accountLifecycleRevision} from '../services/accountStorage'
import {captureRemoteNoteSnapshot} from '../services/remoteNoteSnapshot'
import {confirmDialog,productDialogState,settleProductDialog} from '../services/productDialog'
import {pausePcSync} from '../services/syncResetGuard'
import {requestLocalSync} from '../services/syncSignals'
import {acquireInert} from '../services/inertLease'
const props=defineProps<{noteUid:string;ownerId:string;folders?:Array<{uid:string;name:string}>;areas?:Array<{uid:string;name:string}>;projects?:Array<{uid:string;name:string}>}>(),emit=defineEmits<{close:[]}>(),store=useNotesStore(),auth=useAuthStore()
interface Prepared {note?:NoteEntity;stamp:string;available:boolean;blockReason?:string;operations?:Array<{entityType:string}>}
interface RecoveryService {prepareBodyRecovery(uid:string):Promise<Prepared>;applyBodyRecovery(uid:string,stamp:string,server:NoteEntity,choice:'local'|'server'|'local-note'|'server-note'):Promise<NoteEntity>}
const route=useRoute(),path=route.fullPath
const service=store.service() as unknown as RecoveryService,revision=accountLifecycleRevision(),uid=props.noteUid
const prepared=ref<Prepared>(),server=ref<NoteEntity>(),busy=ref(true),committing=ref(false),error=ref(''),message=ref(''),panel=ref<HTMLElement>()
const mixed=computed(()=>Boolean(prepared.value?.operations?.some(op=>op.entityType==='note')))
function folderName(note:NoteEntity){return note.folderUid?(props.folders?.find(row=>row.uid===note.folderUid)?.name||'目录信息待同步'):'未分类'}
function belonging(note:NoteEntity){return [note.areaUid?(props.areas?.find(row=>row.uid===note.areaUid)?.name||'领域信息待同步'):'未归属领域',note.projectUid?(props.projects?.find(row=>row.uid===note.projectUid)?.name||'项目信息待同步'):''].filter(Boolean).join(' / ')}
let alive=true,release=()=>{},releaseSync=()=>{},origin:HTMLElement|null=null,overflow='',ownedConfirmation:unknown
function check(){if(!alive||route.fullPath!==path||props.noteUid!==uid||accountLifecycleRevision()!==revision||String(auth.user?.userId)!==props.ownerId)throw Error('账号、笔记或窗口已变化，请重新打开')}
function close(){if(!committing.value)emit('close')}
async function load(){busy.value=true;error.value='';message.value='';prepared.value=undefined;server.value=undefined
 try{await store.flushPendingSaves();check();if(typeof service.prepareBodyRecovery!=='function')throw Error('当前版本暂不支持正文恢复');const local=await service.prepareBodyRecovery(uid);check();if(!local.note||!local.available)throw Error(local.blockReason||'没有可手动处理的正文拒绝，请先重试同步');const remote=await captureRemoteNoteSnapshot(check).get(uid);check();prepared.value=local;server.value=remote}
 catch(source){if(alive)error.value=source instanceof Error?source.message:'读取失败，请重试'}finally{if(alive)busy.value=false}
}
async function choose(choice:'local'|'server'){
 const local=prepared.value,remote=server.value;if(!local?.note||!remote||busy.value)return
 busy.value=true;error.value=''
 try{
  const answer=confirmDialog({title:mixed.value?(choice==='local'?'保留本机笔记？':'采用服务器笔记？'):(choice==='local'?'保留本机正文？':'采用服务器正文？'),message:mixed.value?`将一并采用${choice==='local'?'本机':'服务器'}的标题、正文和归属信息。处理时会保存原笔记与队列快照，服务器再次变化时保留冲突。`:'当前本机正文会保留为历史版本。标题、目录和标签等采用服务器当前信息，服务器再次变化时会保留冲突。',confirmText:'确认处理'});ownedConfirmation=productDialogState.resolve;const accepted=await answer;ownedConfirmation=undefined;if(!accepted)return
  check();await store.flushPendingSaves();check();const fresh=await captureRemoteNoteSnapshot(check).get(uid);check()
  if(JSON.stringify(fresh)!==JSON.stringify(remote))throw Error('服务器笔记已变化，请重新比较后选择')
  committing.value=true;await service.applyBodyRecovery(uid,local.stamp,fresh,mixed.value?(choice==='local'?'local-note':'server-note'):choice);check();await store.reloadLocal();check();message.value=mixed.value?'已保留所选笔记，等待正常同步':'已保留所选正文，等待正常同步';prepared.value=undefined;server.value=undefined
 }catch(source){if(alive)error.value=source instanceof Error?source.message:'处理失败，本机内容仍保留'}finally{committing.value=false;if(alive)busy.value=false}
}
function clearConfirmation(){if(ownedConfirmation&&productDialogState.resolve===ownedConfirmation)settleProductDialog(false);ownedConfirmation=undefined}
function invalidated(){clearConfirmation();alive=false;prepared.value=undefined;server.value=undefined;emit('close')}
function keys(event:KeyboardEvent){
 if(productDialogState.open)return
 if(event.key==='Escape'){event.preventDefault();close();return}
 if(event.key!=='Tab'||!panel.value)return
 const nodes=[...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')],first=nodes[0],last=nodes.at(-1)
 if(!first){event.preventDefault();panel.value.focus()}
 else if(!panel.value.contains(document.activeElement)||document.activeElement===panel.value){event.preventDefault();(event.shiftKey?last:first)?.focus()}
 else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
onMounted(async()=>{origin=document.activeElement instanceof HTMLElement?document.activeElement:null;overflow=document.body.style.overflow;release=acquireInert(document.querySelector<HTMLElement>('#app'));document.body.style.overflow='hidden';document.addEventListener('keydown',keys,true);for(const event of ['note-flow:app-locked','note-flow:account-lifecycle-change','note-flow:profile-change'])window.addEventListener(event,invalidated);await nextTick();panel.value?.focus();const resume=await pausePcSync();if(!alive){resume();return}releaseSync=resume;void load()})
onBeforeUnmount(()=>{clearConfirmation();alive=false;releaseSync();requestLocalSync();prepared.value=undefined;server.value=undefined;release();document.body.style.overflow=overflow;document.removeEventListener('keydown',keys,true);for(const event of ['note-flow:app-locked','note-flow:account-lifecycle-change','note-flow:profile-change'])window.removeEventListener(event,invalidated);if(origin?.isConnected)origin.focus({preventScroll:true})})
</script>
<template><Teleport to="body"><div class="body-recovery-backdrop" @click.self="close"><section ref="panel" class="body-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="body-recovery-title" tabindex="-1"><header><h2 id="body-recovery-title">处理正文同步</h2><button aria-label="关闭正文恢复" :disabled="committing" @click="close">×</button></header><p>{{mixed?'标题或归属也有待同步修改，请比较后选择整份笔记；正文及其他笔记信息会一并采用所选版本。':'比较本机与服务器的当前正文，再选择保留哪一份。'}}</p><p v-if="error" role="alert">{{error}}</p><p v-if="message" role="status">{{message}}</p><p v-if="busy&&!prepared" role="status">正在读取当前版本…</p><div v-if="prepared?.note&&server" class="body-recovery-comparison"><section><h3>{{mixed?'本机笔记':'本机正文'}}</h3><strong>{{prepared.note.title}}</strong><dl v-if="mixed"><dt>目录</dt><dd>{{folderName(prepared.note)}}</dd><dt>归属</dt><dd>{{belonging(prepared.note)}}</dd><dt>摘要</dt><dd>{{prepared.note.summary||'未填写'}}</dd><dt>状态</dt><dd>{{prepared.note.status==='archived'?'已归档':'活动'}} · {{prepared.note.pinned?'已置顶':'未置顶'}}</dd></dl><pre>{{prepared.note.content}}</pre></section><section><h3>{{mixed?'服务器笔记':'服务器正文'}}</h3><strong>{{server.title}}</strong><dl v-if="mixed"><dt>目录</dt><dd>{{folderName(server)}}</dd><dt>归属</dt><dd>{{belonging(server)}}</dd><dt>摘要</dt><dd>{{server.summary||'未填写'}}</dd><dt>状态</dt><dd>{{server.status==='archived'?'已归档':'活动'}} · {{server.pinned?'已置顶':'未置顶'}}</dd></dl><pre>{{server.content}}</pre></section></div><footer><button :disabled="busy" @click="load">重新比较</button><template v-if="prepared&&server"><button :disabled="busy" @click="choose('server')">{{mixed?'采用服务器笔记':'采用服务器正文'}}</button><button :disabled="busy" @click="choose('local')">{{mixed?'保留本机笔记':'保留本机正文'}}</button></template></footer></section></div></Teleport></template>
<style scoped>
.body-recovery-comparison dl{display:grid;grid-template-columns:48px minmax(0,1fr);gap:6px;margin:10px 0;font-size:12px}.body-recovery-comparison dd{margin:0;overflow-wrap:anywhere}.body-recovery-comparison strong{overflow-wrap:anywhere}

.body-recovery-backdrop{position:fixed;inset:0;z-index:950;display:grid;place-items:center;padding:16px;background:#14271d66}.body-recovery-dialog{box-sizing:border-box;width:min(1000px,100%);max-height:90dvh;overflow:auto;padding:22px;border-radius:12px;background:var(--pc-surface,#fff);color:var(--pc-text)}header,footer{display:flex;align-items:center;justify-content:space-between;gap:8px}h2{margin:0;font-size:18px}h3{font-size:13px}p{font-size:12px;color:var(--pc-muted)}[role=alert]{color:#a33}.body-recovery-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.body-recovery-comparison section{min-width:0}pre{max-height:50dvh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border-radius:8px;background:#f5f7f6;font:13px/1.65 monospace}button{padding:7px 12px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}footer{justify-content:flex-end;flex-wrap:wrap;margin-top:16px}@media(max-width:720px){.body-recovery-comparison{grid-template-columns:1fr}pre{max-height:30dvh}}
</style>
