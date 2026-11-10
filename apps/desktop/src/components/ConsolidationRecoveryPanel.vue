<script setup lang="ts">
import {defineAsyncComponent,onBeforeUnmount,onMounted,ref} from 'vue'
import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from '@note-flow/core/contracts'
import {aiDataScope} from '../services/aiDataScope'
import {accountSessionRevision} from '../services/accountStorage'
import {consolidationPendingRequest,consolidationDraftSources,createConsolidationDrafts,listConsolidationDrafts,type ConsolidationDraft} from '../services/consolidationDraft'
import {ensureConsolidationCapability} from '../services/consolidationCapability'
import {useNotesStore} from '../stores/notes'
import api from '../services/api'
import {confirmDialog} from '../services/productDialog'
const Editor=defineAsyncComponent(()=>import('./NoteConsolidationDialog.vue'))
const props=defineProps<{ownerId:string;folders:FolderEntity[]}>(),emit=defineEmits<{changed:[uid?:string]}>(),store=useNotesStore()
const scope=aiDataScope(),revision=accountSessionRevision(),rows=ref<ConsolidationDraft[]>([]),busy=ref(false),message=ref(''),confirmed=ref(''),editing=ref<NoteEntity[]>(),limit=ref(10)
let active=true
const current=()=>active&&scope===aiDataScope()&&revision===accountSessionRevision()
function assertScope(){if(!current())throw Error('账号或空间已切换，请重新打开整合记录')}
async function refresh(){try{assertScope();const values=await listConsolidationDrafts(scope);assertScope();rows.value=values}catch{if(current())message.value='无法读取本机整合稿，请检查存储权限'}}
const drafts=(row:ConsolidationDraft)=>createConsolidationDrafts(scope,consolidationDraftSources(row))
async function continueEditing(row:ConsolidationDraft){busy.value=true;message.value='';try{assertScope();const service=store.service(),notes=await Promise.all(consolidationDraftSources(row).map(uid=>service.get(uid)));assertScope();if(notes.some(note=>!note||note.deleted))throw Error('部分来源已不存在；可以先查看整合稿，再另存为新笔记');editing.value=notes as NoteEntity[]}catch(source){if(current())message.value=source instanceof Error?source.message:'无法恢复整合稿'}finally{busy.value=false}}
async function saveCopy(row:ConsolidationDraft){if(row.operationUid)return;busy.value=true;message.value='';try{assertScope();const service=store.service();const note=await service.create({title:row.title.trim()||'整合笔记',content:row.content,type:'note',contentFormat:'markdown',captureSource:'ai_consolidation'});assertScope();await drafts(row).clear();await store.reloadLocal();assertScope();emit('changed',note.uid);message.value='整合稿已另存为新笔记，来源未修改';await refresh()}catch(source){if(current())message.value=source instanceof Error?source.message:'保存失败'}finally{busy.value=false}}
async function retry(row:ConsolidationDraft){
 if(confirmed.value!==row.key)return;busy.value=true;message.value=''
 try{assertScope();const request=consolidationPendingRequest(row)
  await ensureConsolidationCapability(path=>api.get(path));assertScope();const response=await api.post('/notes/consolidations',request);assertScope();await drafts(row).clear();emit('changed',response.data.data.targetUid);await refresh();await store.runSync();await store.reloadLocal();assertScope();message.value='替换结果已确认，可在最近整合记录中撤销'
 }catch(source){if(current())message.value=source instanceof Error?source.message:'提交结果仍未确认；本机稿和原操作标识已保留'}finally{busy.value=false}
}
async function discard(row:ConsolidationDraft){if(row.operationUid)return;if(!await confirmDialog('丢弃这份本机整合稿？来源笔记保持不变。'))return;busy.value=true;try{assertScope();await drafts(row).clear();await refresh()}catch{if(current())message.value='清除失败，整合稿仍保留'}finally{busy.value=false}}
onMounted(refresh);onBeforeUnmount(()=>{active=false})
</script>
<template><section v-if="rows.length||message" class="consolidation-recovery"><header><h3>本机待处理整合稿 · {{rows.length}}</h3><button :disabled="busy" @click="refresh">刷新</button></header><p>这里不会自动调用 AI 或替换笔记。提交结果待确认时，重试沿用原操作标识和原参数。</p><article v-for="row in rows.slice(0,limit)" :key="row.key"><strong>{{row.title||'未命名整合稿'}}</strong><small>{{row.operationUid?'替换结果待确认':row.ready?'待审阅':'生成未完成'}} · {{new Date(row.updatedAt).toLocaleString()}}</small><details><summary>查看本机整合稿</summary><pre>{{row.content}}</pre></details><template v-if="row.operationUid"><label><input v-model="confirmed" type="radio" :value="row.key" :disabled="busy"/>已审阅，确认用原参数重试替换请求；已完成的请求不会重复创建笔记</label><button :disabled="busy||confirmed!==row.key" @click="retry(row)">确认上次提交结果</button></template><div v-else><button :disabled="busy" @click="continueEditing(row)">继续编辑</button><button :disabled="busy||!row.content.trim()" @click="saveCopy(row)">另存为新笔记</button><button :disabled="busy" @click="discard(row)">丢弃本机稿</button></div></article><button v-if="rows.length>limit" @click="limit+=10">显示更多</button><p v-if="message" role="status">{{message}}</p><Teleport to="body"><Editor v-if="editing" :notes="editing" :folders="folders" :owner-id="ownerId" restore-local-draft @close="editing=undefined;refresh()" @changed="emit('changed',$event);refresh()"/></Teleport></section></template>
<style scoped>
.consolidation-recovery{margin:16px 0;padding:12px;border:1px solid var(--pc-border);border-radius:9px}.consolidation-recovery header{display:flex;align-items:center;justify-content:space-between;gap:10px}h3{margin:0;font-size:14px}article{display:grid;gap:8px;padding:12px 0;border-top:1px solid var(--pc-border)}small,p{font-size:12px;color:var(--pc-muted)}pre{max-height:260px;overflow:auto;white-space:pre-wrap;font:12px/1.6 monospace}label{font-size:12px;line-height:1.6}button{padding:6px 10px;border:1px solid var(--pc-border);border-radius:6px;cursor:pointer}article>div{display:flex;flex-wrap:wrap;gap:8px}
</style>
