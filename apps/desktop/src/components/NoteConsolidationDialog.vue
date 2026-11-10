<script setup lang="ts">
import {computed,defineAsyncComponent,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from '@note-flow/core/contracts'
import api from '../services/api'
import {ensureConsolidationCapability,consolidationRejected} from '../services/consolidationCapability'
import {localAttachments} from '../services/attachments'
import {aiClientConfig,aiLocalScope} from '../services/aiClientConfig'
import {reviewConsolidationSources} from '../services/consolidationReview'
import {consolidationInput,noteStamp} from '../services/noteConsolidation'
import {generateConsolidation} from '../services/noteConsolidationAi'
import {aiDataScope} from '../services/aiDataScope'
import {createConsolidationDrafts,consolidationSourceHash,clearConsolidationDrafts,type ConsolidationDraft} from '../services/consolidationDraft'
import {registerLocalDraftGuard} from '../services/localDraftLifecycle'
import {useNotesStore} from '../stores/notes'
const RecoveryPanel=defineAsyncComponent(()=>import('./ConsolidationRecoveryPanel.vue'))
const MarkdownPreview=defineAsyncComponent(()=>import('./MarkdownPreview.vue'))
const previewDraft=ref(false)
const props=defineProps<{notes:NoteEntity[];folders:FolderEntity[];ownerId:string;initialInstruction?:string;restoreLocalDraft?:boolean}>()
const emit=defineEmits<{close:[];changed:[uid?:string]}>()
const store=useNotesStore(),scope=aiLocalScope(),approvedModel=JSON.stringify(aiClientConfig())
const sources=JSON.parse(JSON.stringify(props.notes)) as NoteEntity[]
const mode=ref('系统整理'),instruction=ref(props.initialInstruction||''),consent=ref(false),replacementConsent=ref(false),title=ref('整合笔记'),content=ref(''),folderUid=ref(sources[0]?.folderUid||''),busy=ref(false),error=ref(''),message=ref(''),draftReady=ref(false),operationUid=ref('')
const sourceReview=computed(()=>reviewConsolidationSources(sources,content.value))
const history=ref<Array<{uid:string;targetUid:string;state:string}>>([])
const inputError=computed(()=>{if(sources.length<2)return '';try{consolidationInput(sources);return ''}catch(error){return error instanceof Error?error.message:'来源不适合整合'}})
const availableFolders=computed(()=>props.folders.filter(folder=>(folder.areaUid||'')===(sources[0]?.areaUid||'')&&(folder.projectUid||'')===(sources[0]?.projectUid||'')))
const model=computed(()=>{const config=aiClientConfig();return `${config.channel==='local'?'本地模型':config.channel==='personal'?'个人模型服务':'账号模型服务'} · ${config.model||'默认模型'}`})
const draftScope=aiDataScope(),drafts=createConsolidationDrafts(draftScope,sources.map(note=>note.uid)),savedDraft=ref<ConsolidationDraft>(),draftLoading=ref(true)
const sourceHash=consolidationSourceHash(sources.map(noteStamp))
let pendingRequest:Record<string,unknown>|undefined
let draftTimer:ReturnType<typeof setTimeout>|undefined,draftWrites=Promise.resolve(),suppressDraft=false
async function persistDraft(){
 if(suppressDraft||draftLoading.value||!content.value||savedDraft.value)return
 assertScope()
 const hash=await sourceHash;assertScope();if(suppressDraft)return
 const value={sourceHash:hash,title:title.value,content:content.value,folderUid:folderUid.value,mode:mode.value,instruction:instruction.value,ready:draftReady.value,operationUid:operationUid.value,request:pendingRequest}
 draftWrites=draftWrites.catch(()=>undefined).then(()=>drafts.save(value));await draftWrites
}
function scheduleDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>{void persistDraft().catch(()=>{error.value='整合稿未能保存在本机，请保持窗口打开并检查存储空间'})},500)}
watch([title,content,folderUid,mode,instruction,draftReady,operationUid],scheduleDraft)
async function closeDialog(){try{clearTimeout(draftTimer);await persistDraft();emit('close')}catch{error.value='本机保存失败，尚未关闭；请先复制整合稿'}}
async function restoreDraft(){const value=savedDraft.value;if(!value)return;if(!value.operationUid&&value.sourceHash!==await sourceHash){error.value='来源已变化，无法恢复此次替换；请重新生成整合稿';return}mode.value=value.mode;instruction.value=value.instruction;await nextTick();title.value=value.title;content.value=value.content;folderUid.value=value.folderUid;draftReady.value=value.ready;operationUid.value=value.operationUid;pendingRequest=value.request;savedDraft.value=undefined;consent.value=false;replacementConsent.value=false;message.value=value.operationUid?'存在结果待确认的提交，请重试确认替换或查看最近整合记录':'已恢复本机整合稿，请重新审阅后操作'}
async function discardDraft(){if(savedDraft.value?.operationUid){error.value='此次提交结果尚未确认，请先恢复并重试，避免重复替换';return}try{await drafts.clear();savedDraft.value=undefined}catch{error.value='清除本机整合稿失败'}}
function resetDraft(){suppressDraft=true;controller?.abort();content.value='';savedDraft.value=undefined;void draftWrites.catch(()=>undefined).then(()=>clearConsolidationDrafts(draftScope)).catch(()=>undefined)}
const unregisterDraft=registerLocalDraftGuard({}, {flush:persistDraft,dirty:()=>Boolean(content.value&&!suppressDraft)})
let controller:AbortController|undefined
watch([mode,instruction],()=>{consent.value=false;draftReady.value=false})
onBeforeUnmount(()=>{unregisterDraft();controller?.abort();clearTimeout(draftTimer);window.removeEventListener('note-flow:account-data-reset',resetDraft)})
function newOperationUid(){const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`}
function assertScope(){if(scope!==aiLocalScope()||draftScope!==aiDataScope())throw Error('空间已切换，请关闭后重新选择笔记')}
async function refreshHistory(){try{assertScope();const response=await api.get('/notes/consolidations');assertScope();history.value=response.data.data||[]}catch{if(sources.length<2)error.value='无法读取整合记录，请检查网络及服务端是否已更新'}}
onMounted(async()=>{window.addEventListener('note-flow:account-data-reset',resetDraft);try{if(sources.length>=2)savedDraft.value=await drafts.read()}catch{error.value='无法读取本机整合稿，请检查存储权限'}finally{draftLoading.value=false}if(props.restoreLocalDraft&&savedDraft.value)await restoreDraft();await refreshHistory()})
async function generate(){
 if(savedDraft.value||draftLoading.value)return
 if(operationUid.value){error.value='请先重试确认替换，或关闭后检查最近整合记录';return}
 suppressDraft=false;error.value='';message.value='';draftReady.value=false;operationUid.value='';replacementConsent.value=false
 if(!consent.value)return
 busy.value=true;controller=new AbortController()
 try{assertScope();if(approvedModel!==JSON.stringify(aiClientConfig()))throw Error('模型配置已变化，请重新打开对话框确认');consolidationInput(sources);content.value='';content.value=await generateConsolidation(sources,mode.value,instruction.value,controller.signal,value=>{assertScope();content.value=value});assertScope();draftReady.value=true}
 catch{error.value=controller.signal.aborted?'已停止生成；原笔记未修改':'生成失败，请检查模型设置，或减少所选内容（上限 30,000 字符）；原笔记未修改'}finally{busy.value=false;controller=undefined}
}
async function verifySources(){await store.flushPendingSaves();assertScope();for(const source of sources){const current=await store.service().get(source.uid);if(!current||noteStamp(current)!==noteStamp(source))throw Error('来源已经修改，请关闭对话框后重新选择和生成')}}
async function saveDraft(){busy.value=true;error.value='';try{await verifySources();const note=await store.create({title:title.value.trim(),content:content.value,type:'note',contentFormat:'markdown',areaUid:sources[0]?.areaUid,projectUid:sources[0]?.projectUid,folderUid:folderUid.value||undefined,tagUids:[...new Set(sources.flatMap(note=>note.tagUids||[]))],tagIds:[...new Set(sources.flatMap(note=>note.tagIds||[]))],captureSource:'ai_consolidation'});suppressDraft=true;clearTimeout(draftTimer);await draftWrites;await drafts.clear();emit('changed',note.uid);message.value='整合稿已保存，原笔记保留';draftReady.value=false}catch(source){error.value=source instanceof Error?source.message:'保存失败'}finally{busy.value=false}}
async function replace(){
 if(!replacementConsent.value)return
 busy.value=true;error.value='';message.value=''
 try{
  await ensureConsolidationCapability(path=>api.get(path));assertScope()
  if(!operationUid.value){await verifySources();for(const source of sources){const attachments=await localAttachments(props.ownerId,source.uid);if(attachments.some(file=>['pending','uploading','uploaded_needs_link','failed'].includes(file.status)))throw Error('来源仍有未上传的附件，请完成同步后再替换')}}assertScope();if(navigator.onLine===false)throw Error('确认替换需要联网')
  if(!operationUid.value)operationUid.value=newOperationUid()
  pendingRequest??={uid:operationUid.value,sources:sources.map(note=>({uid:note.uid,version:note.version,status:note.status})),draft:{title:title.value.trim(),content:content.value,folderUid:folderUid.value||null,areaUid:sources[0]?.areaUid,projectUid:sources[0]?.projectUid}}
  await persistDraft();assertScope()
  const result=await api.post('/notes/consolidations',pendingRequest)
  assertScope();suppressDraft=true;clearTimeout(draftTimer);await draftWrites;await drafts.clear();message.value='整合完成，原笔记已移入回收站';draftReady.value=false;await store.runSync();await store.reloadLocal();emit('changed',result.data.data.targetUid);await refreshHistory()
 }catch(source){const status=(source as {status?:number}).status;// A timed-out response may already have committed; retry with the same identity.
  if(consolidationRejected(source)){operationUid.value='';pendingRequest=undefined}
  error.value=status===404?'服务端尚未支持整合替换，需要更新后端；可以先保存整合稿':source instanceof Error?source.message:'提交结果尚未确认，请重试或查看整合记录'}finally{busy.value=false}
}
async function undo(uid:string){busy.value=true;error.value='';try{assertScope();await api.post(`/notes/consolidations/${uid}/undo`);assertScope();await store.runSync();await store.reloadLocal();message.value='来源笔记已恢复，整合稿保留';emit('changed');await refreshHistory()}catch(source){error.value=source instanceof Error?source.message:'撤销失败'}finally{busy.value=false}}
</script>
<template>
 <div class="pc-modal-backdrop" @click.self="!busy&&closeDialog()"><section class="consolidation-dialog" role="dialog" aria-modal="true" aria-labelledby="consolidation-heading">
  <header><h2 id="consolidation-heading">{{sources.length>=2?'整合笔记':'整合记录'}}</h2><button :disabled="busy" aria-label="关闭整合" @click="closeDialog">×</button></header>
  <template v-if="sources.length>=2">
  <p v-if="draftLoading" role="status">正在检查本机整合稿…</p>
  <div v-if="savedDraft" role="status"><p>发现此组笔记的本机整合稿。恢复不会自动发送内容或替换笔记。</p><button @click="restoreDraft">恢复整合稿</button><button @click="discardDraft">丢弃</button></div>
  <p>先审阅整合稿，再确认将来源移入回收站。来源标签会合并，附件会保留；复杂引用尚不能自动迁移时会阻止替换。</p>
  <details><summary>{{sources.length}} 篇来源 · {{model}}</summary><ul><li v-for="note in sources" :key="note.uid">{{note.title||'未命名笔记'}}</li></ul></details>
  <div class="consolidation-options"><label>整理方式<select v-model="mode" :disabled="busy||Boolean(operationUid)"><option>系统整理</option><option>去重合并</option></select></label><label>目标目录<select v-model="folderUid" :disabled="busy||Boolean(operationUid)"><option value="">无目录</option><option v-for="folder in availableFolders" :key="folder.uid" :value="folder.uid">{{folder.name}}</option></select></label></div>
  <label>补充要求<input v-model="instruction" :disabled="busy||Boolean(operationUid)" placeholder="例如：按主题归纳，保留操作步骤"></label>
  <label class="consolidation-check"><input v-model="consent" type="checkbox" :disabled="busy">允许将上述笔记的完整标题、正文和补充要求发送给当前配置的 {{model}}。附件文件不发送；正文中的链接和图片地址会发送。</label>
  <button :disabled="busy||draftLoading||Boolean(savedDraft)||Boolean(operationUid)||!consent||Boolean(inputError)" @click="generate">{{busy?'处理中…':draftReady?'重新生成':'生成整合稿'}}</button><button v-if="busy&&controller" @click="controller.abort()">停止生成</button>
  <template v-if="content"><label>新笔记标题<input v-model="title" maxlength="200" :disabled="busy||Boolean(operationUid)"></label><div class="consolidation-editor-heading"><strong>整合稿</strong><div><button :aria-pressed="!previewDraft" @click="previewDraft=false">编辑</button><button :aria-pressed="previewDraft" @click="previewDraft=true">预览</button></div></div><div v-if="previewDraft" class="consolidation-preview"><MarkdownPreview :content="content" :owner-id="ownerId" note-uid="consolidation-preview"/></div><label v-else class="consolidation-editor"><textarea v-model="content" aria-label="整合稿正文" :disabled="busy||Boolean(operationUid)" rows="15"/></label><details class="consolidation-review"><summary>来源核对 · {{sourceReview.filter(row=>row.missingLinks.length||row.missingNumbers.length||!row.hasSourceMarker).length}} 篇需要检查</summary><p>以下检查只在本机比较链接、数字和来源标记，不能判断事实正确性或语义遗漏。改写、去重也可能产生提示。</p><section v-for="row in sourceReview" :key="row.uid"><strong>来源 {{row.index}} · {{row.title}}</strong><p v-if="!row.hasSourceMarker">未发现 [来源{{row.index}}] 标记，请确认该来源已被整合。</p><p v-if="row.missingLinks.length">未发现的链接（{{row.missingLinks.length}}）：{{row.missingLinks.slice(0,10).join('、')}}</p><p v-if="row.missingNumbers.length">未发现的数字（{{row.missingNumbers.length}}）：{{row.missingNumbers.slice(0,15).join('、')}}</p><details><summary>查看来源原文</summary><pre>{{sources[row.index-1].content}}</pre></details></section></details><p>请检查事实、重复内容和遗漏后再替换原笔记。</p><label class="consolidation-check"><input v-model="replacementConsent" type="checkbox" :disabled="busy">已审阅整合稿，确认将这 {{sources.length}} 篇来源移入回收站</label><footer><button :disabled="busy||Boolean(operationUid)||!draftReady||!title.trim()" @click="saveDraft">仅保存整合稿</button><button class="primary-action" :disabled="busy||!draftReady||!replacementConsent||!title.trim()||!content.trim()" @click="replace">{{operationUid?'重试确认替换':'确认替换原笔记'}}</button></footer></template>
  <p v-if="inputError" class="consolidation-error">{{inputError}}</p>
  </template>
  <p v-if="error" role="alert" class="consolidation-error">{{error}}</p><p v-if="message" role="status">{{message}}</p>
  <RecoveryPanel v-if="sources.length<2" :owner-id="ownerId" :folders="folders" @changed="emit('changed',$event);refreshHistory()"/>
  <p v-if="sources.length<2&&!history.length&&!error">暂无整合记录</p>
  <details v-if="history.length" :open="sources.length<2"><summary>最近整合记录</summary><div v-for="item in history" :key="item.uid" class="consolidation-history"><span>{{item.state==='undone'?'已撤销':'已完成'}} · {{item.uid.slice(0,8)}}</span><button v-if="item.state==='complete'" :disabled="busy" @click="undo(item.uid)">撤销（保留整合稿）</button></div></details>
 </section></div>
</template>
<style scoped>
.consolidation-review section{padding:10px 0;border-bottom:1px solid var(--pc-border);overflow-wrap:anywhere}.consolidation-review pre{max-height:240px;overflow:auto;white-space:pre-wrap;font:12px/1.6 monospace}
.consolidation-dialog{width:min(780px,calc(100vw - 32px));max-height:90vh;overflow:auto;padding:24px;background:var(--pc-surface,#fff);border-radius:14px;color:var(--pc-text);box-shadow:0 20px 70px #0003}.consolidation-dialog header,.consolidation-dialog footer,.consolidation-options,.consolidation-history{display:flex;align-items:center;justify-content:space-between;gap:12px}.consolidation-dialog h2{margin:0;font-size:18px}.consolidation-dialog p,.consolidation-dialog details{font-size:13px;line-height:1.6;color:var(--pc-muted)}.consolidation-dialog label{display:flex;flex-direction:column;gap:6px;margin:12px 0;font-size:13px}.consolidation-options>label{flex:1}.consolidation-dialog input:not([type=checkbox]),.consolidation-dialog select,.consolidation-dialog textarea{box-sizing:border-box;width:100%;border:1px solid var(--pc-border);border-radius:7px;padding:9px;background:var(--pc-surface,#fff);color:inherit}.consolidation-dialog textarea{resize:vertical;line-height:1.6;font:13px/1.6 monospace}.consolidation-dialog .consolidation-check{flex-direction:row;align-items:flex-start;line-height:1.6}.consolidation-dialog button{padding:7px 12px;border:1px solid var(--pc-border);border-radius:7px;cursor:pointer}.consolidation-dialog button:disabled{opacity:.45;cursor:not-allowed}.consolidation-dialog .consolidation-error{color:#b42318}.consolidation-history{padding:8px 0}.consolidation-editor-heading{display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:13px}.consolidation-editor-heading button[aria-pressed=true]{background:var(--pc-primary);color:white}.consolidation-preview{max-height:400px;overflow:auto;border:1px solid var(--pc-border);border-radius:8px;padding:14px;margin-top:10px}
</style>
