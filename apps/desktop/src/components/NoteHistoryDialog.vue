<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref} from 'vue'
import type {NoteEntity} from '@note-flow/core'
import type {RemoteHistorySummary,RemoteHistoryDetail} from '@note-flow/core/remote-note-history'
import {createNoteHistory,historyStamp,type NoteRevision} from '../services/noteHistory'
import {clientOwnerScope} from '../services/clientContext'
import {accountLifecycleRevision} from '../services/accountStorage'
import {useNotesStore} from '../stores/notes'
import {useAuthStore} from '../stores/auth'
import {confirmDialog} from '../services/productDialog'
import {captureRemoteNoteHistory,remoteNoteHistoryAvailable} from '../services/remoteNoteHistory'
const props=defineProps<{noteUid:string;ownerId:string}>(),emit=defineEmits<{close:[]}>()
const noteUid=props.noteUid
const store=useNotesStore(),auth=useAuthStore(),scope=clientOwnerScope(props.ownerId),session=accountLifecycleRevision(),history=createNoteHistory(scope)
const rows=ref<NoteRevision[]>([]),selectedId=ref(''),current=ref<NoteEntity>(),busy=ref(false),error=ref(''),message=ref('')
const source=ref<'local'|'server'>('local'),serverRows=ref<RemoteHistorySummary[]>([]),serverSelected=ref<RemoteHistoryDetail>(),cursor=ref<number|null>(null)
let alive=true,generation=0,remote:ReturnType<typeof captureRemoteNoteHistory>|undefined
const selected=computed(()=>source.value==='local'?rows.value.find(row=>row.id===selectedId.value):serverSelected.value?{...serverSelected.value,id:serverSelected.value.uid,summary:current.value?.summary??null}:undefined)
const changed=computed(()=>selected.value&&current.value&&(selected.value.title!==current.value.title||selected.value.content!==current.value.content||selected.value.summary!==(current.value.summary??null)))
function assertScope(){if(!alive||props.noteUid!==noteUid||clientOwnerScope(props.ownerId)!==scope||accountLifecycleRevision()!==session||String(auth.user?.userId)!==props.ownerId)throw Error('当前账号或窗口已变化，请关闭后重试')}
async function load(){const request=++generation;busy.value=true;error.value='';serverSelected.value=undefined
 try{await store.flushPendingSaves();assertScope();const note=await store.service().get(props.noteUid);assertScope()
 const versions=await history.list(props.noteUid);assertScope();if(request!==generation)return
 current.value=note;rows.value=versions;if(!versions.some(row=>row.id===selectedId.value))selectedId.value=versions[0]?.id||''
 if(source.value==='server'){remote=captureRemoteNoteHistory(assertScope);const page=await remote.list(props.noteUid);assertScope();if(request!==generation)return;serverRows.value=page.items;cursor.value=page.nextBeforeRevision}
 }catch(source){if(alive&&request===generation)error.value=source instanceof Error?source.message:'无法读取历史版本，请重试'}finally{if(alive&&request===generation)busy.value=false}}
async function switchSource(value:'local'|'server'){if(busy.value)return;source.value=value;serverRows.value=[];cursor.value=null;await load()}
async function moreServer(){if(busy.value||cursor.value===null||!remote)return;const request=generation;busy.value=true;error.value=''
 try{const page=await remote.list(props.noteUid,cursor.value);assertScope();if(request!==generation)return;const known=new Set(serverRows.value.map(row=>row.uid));serverRows.value.push(...page.items.filter(row=>!known.has(row.uid)));cursor.value=page.nextBeforeRevision}
 catch(source){if(alive&&request===generation)error.value=source instanceof Error?source.message:'服务器历史读取失败'}finally{if(alive&&request===generation)busy.value=false}}
async function selectServer(row:RemoteHistorySummary){if(busy.value||!remote)return;const request=generation;busy.value=true;error.value='';serverSelected.value=undefined
 try{const detail=await remote.get(props.noteUid,row.uid);assertScope();if(request===generation){if(detail.revision!==row.revision)throw Error('服务器历史版本不一致，请刷新');serverSelected.value=detail}}
 catch(source){if(alive&&request===generation)error.value=source instanceof Error?source.message:'历史正文读取失败'}finally{if(alive&&request===generation)busy.value=false}}
async function restore(){if(!current.value||!selected.value)return;const expected=historyStamp(current.value),version=selected.value,local=source.value==='local'
 if(!await confirmDialog(local?'将恢复所选版本的标题、正文和摘要。当前内容会保留为历史版本；目录、标签和附件归属保持原样。':'将恢复服务器版本的标题和正文，当前摘要及归属保持原样。当前内容会先保留在本机历史中。'))return
 busy.value=true;error.value=''
 try{await store.flushPendingSaves();assertScope();const latest=await store.service().get(props.noteUid);assertScope();if(!latest||latest.deleted||historyStamp(latest)!==expected)throw Error('笔记已变化，请刷新后重新选择版本')
 const update=async(restored:NoteEntity)=>{assertScope();const fresh=await store.service().get(props.noteUid);assertScope();if(!fresh||historyStamp(fresh)!==expected)throw Error('笔记已变化，请刷新后重新选择版本');return store.updateEntity(fresh,{title:restored.title,content:restored.content,summary:restored.summary})}
 if(local)await history.restore(latest,version.id,expected,update)
 else{await history.capture(latest,'restore');assertScope();await update({...latest,title:version.title,content:version.content})}
 assertScope();message.value='历史版本已恢复，等待正常同步';await load()
 }catch(source){if(alive)error.value=source instanceof Error?source.message:'恢复失败'}finally{if(alive)busy.value=false}}
function locked(){alive=false;generation++;rows.value=[];serverRows.value=[];serverSelected.value=undefined;current.value=undefined;remote=undefined;emit('close')}
onMounted(()=>{void load();window.addEventListener('note-flow:app-locked',locked);window.addEventListener('note-flow:account-lifecycle-change',locked);window.addEventListener('note-flow:profile-change',locked)})
onBeforeUnmount(()=>{alive=false;generation++;window.removeEventListener('note-flow:app-locked',locked);window.removeEventListener('note-flow:account-lifecycle-change',locked);window.removeEventListener('note-flow:profile-change',locked)})
</script>
<template>
 <div class="pc-modal-backdrop" @click.self="!busy&&emit('close')"><section class="note-history-dialog" role="dialog" aria-modal="true" aria-labelledby="note-history-title">
  <header><h2 id="note-history-title">笔记历史版本</h2><button type="button" aria-label="关闭历史版本" :disabled="busy" @click="emit('close')">×</button></header>
  <div class="history-sources" aria-label="历史来源"><button :aria-pressed="source==='local'" :disabled="busy" @click="switchSource('local')">本机历史</button><button :aria-pressed="source==='server'" :disabled="busy||!remoteNoteHistoryAvailable()" @click="switchSource('server')">服务器历史</button></div>
  <p class="history-hint">本机保留最近 50 个修改前版本；服务器历史可查看其他设备已同步的版本，需服务端支持。离线未上传的历史仍留在各自设备。恢复不会找回已删除的附件文件。</p>
  <p v-if="error" role="alert">{{error}}</p><p v-if="message" role="status">{{message}}</p>
  <div v-if="(source==='local'?rows.length:serverRows.length)&&current" class="history-body"><nav aria-label="历史版本"><template v-if="source==='local'"><button v-for="row in rows" :key="row.id" :aria-pressed="row.id===selectedId" :disabled="busy" @click="selectedId=row.id"><time>{{new Date(row.createdAt).toLocaleString()}}</time><small>{{row.reason==='restore'?'恢复前':row.reason==='delete'?'删除前':row.reason==='remote'?'远端覆盖前':'修改前'}}</small></button></template><template v-else><button v-for="row in serverRows" :key="row.uid" :aria-pressed="row.uid===serverSelected?.uid" :disabled="busy" @click="selectServer(row)"><time>{{new Date(row.createdAt).toLocaleString()}}</time><small>服务器版本 {{row.revision}}</small></button><button v-if="cursor!==null" :disabled="busy" @click="moreServer">加载更早版本</button></template></nav><section v-if="selected" class="history-comparison"><div><h3>当前内容</h3><strong>{{current.title}}</strong><p v-if="current.summary">摘要：{{current.summary}}</p><pre>{{current.content}}</pre></div><div><h3>所选历史版本</h3><strong>{{selected.title}}</strong><p v-if="selected.summary">摘要：{{selected.summary}}</p><pre>{{selected.content}}</pre></div></section><p v-else>选择一个版本查看内容</p></div>
  <p v-else-if="!busy&&!error">暂无历史版本。尚未上传的修改只能在原设备的本机历史中查看。</p>
  <footer><button type="button" :disabled="busy" @click="load">刷新</button><button type="button" :disabled="busy||!changed||current?.deleted" @click="restore">{{busy?'处理中…':'恢复此版本'}}</button></footer>
 </section></div>
</template>
<style scoped>
.note-history-dialog{width:min(1000px,calc(100vw - 32px));max-height:90vh;overflow:auto;padding:22px;border-radius:12px;background:var(--pc-surface,#fff);color:var(--pc-text)}
.history-sources{display:flex;gap:8px;margin-top:12px}.history-sources button[aria-pressed=true]{border-color:var(--pc-primary);background:var(--pc-primary-soft)}
header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{margin:0;font-size:18px}.history-hint{font-size:12px;line-height:1.6;color:var(--pc-muted)}button{padding:7px 10px;border:1px solid var(--pc-border);border-radius:6px;background:var(--pc-surface,#fff);color:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}.history-body{display:grid;grid-template-columns:180px minmax(0,1fr);gap:16px;min-height:240px}nav{display:flex;flex-direction:column;gap:6px;max-height:55vh;overflow:auto}nav button{display:grid;gap:4px;text-align:left;font-size:12px}nav button[aria-pressed=true]{border-color:var(--pc-primary);background:var(--pc-primary-soft)}nav small{color:var(--pc-muted)}.history-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.history-comparison>div{min-width:0}h3{font-size:12px;color:var(--pc-muted)}pre{max-height:45vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 monospace;padding:10px;background:var(--pc-bg,#f6f8f7);border-radius:6px}footer{justify-content:flex-end;margin-top:16px}@media(max-width:760px){.history-body{grid-template-columns:1fr}nav{max-height:110px}.history-comparison{grid-template-columns:1fr}}
</style>
