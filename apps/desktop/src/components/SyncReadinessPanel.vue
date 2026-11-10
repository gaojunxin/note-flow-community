<script setup lang="ts">
import {syncQueueInspectionService,type SyncQueueInspection} from '../services/syncQueueInspection'
import SyncOverviewCard from './SyncOverviewCard.vue'
import {ElButton} from 'element-plus'
import LocalRestoreNotice from './LocalRestoreNotice.vue'
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {useNotesStore} from '../stores/notes'
import {localAttachments,type LocalAttachment} from '../services/attachments'
import {clientOwnerScope} from '../services/clientContext'
import api from '../services/api'
import {createSyncCompatibilityChecker} from '../services/syncCompatibility'
import {accountLifecycleRevision,accountSessionRevision} from '../services/accountStorage'
import {clientServerUrl} from '../services/clientContext'
import {buildSyncDiagnostic} from '../services/syncDiagnostic'
import {syncTransportHealth} from '../services/syncTransportHealth'
import {saveLocalExport} from '../services/localFileExport'
import {appInfo} from '../services/appInfo'
import {isDesktopClient} from '../services/serverConfig'
import {syncActivity} from '../services/syncActivity'
const props=defineProps<{connected?:boolean;inspectionBusy?:boolean;ownerId:string;failedTasks:number;failedChanges?:number;conflicts:number}>(),store=useNotesStore(),router=useRouter()
const online=ref(navigator.onLine!==false)
const updateOnline=()=>{online.value=navigator.onLine!==false}
const exporting=ref(false),diagnosticMessage=ref(''),compatibilityBusy=ref(false),compatibilityMessage=ref('尚未检查客户端与服务器版本兼容性')
const compatibilityChecker=createSyncCompatibilityChecker(path=>api.get(path))
const inspection=ref<SyncQueueInspection|null>(null)
const attachments=ref<LocalAttachment[]>([]),error=ref(''),loading=ref(true)
let generation=0
async function refresh(){const request=++generation,scope=clientOwnerScope(props.ownerId),revision=accountLifecycleRevision();loading.value=true;try{const [rows,queue]=await Promise.all([localAttachments(props.ownerId),syncQueueInspectionService.read(props.ownerId)]);if(request!==generation||scope!==clientOwnerScope(props.ownerId)||revision!==accountLifecycleRevision())return;attachments.value=rows;inspection.value=queue;error.value=''}catch{if(request===generation){inspection.value=null;error.value='无法完整读取本机队列，请重新检查'}}finally{if(request===generation)loading.value=false}}
const resetInspection=()=>{generation++;inspection.value=null;attachments.value=[];diagnosticMessage.value='';void refresh()}
const requestSummary=computed(()=>{void syncActivity.finishedAt;const rows=syncTransportHealth.read(clientOwnerScope(props.ownerId));return {requests:rows.reduce((sum,row)=>sum+row.requests,0),failed:rows.reduce((sum,row)=>sum+row.failed,0),partial:rows.reduce((sum,row)=>sum+row.partial,0)}})
async function checkCompatibility(){
 if(compatibilityBusy.value)return;compatibilityBusy.value=true;const owner=props.ownerId,scope=clientOwnerScope(owner),revision=accountSessionRevision(),server=clientServerUrl();const current=()=>owner===props.ownerId&&scope===clientOwnerScope(props.ownerId)&&revision===accountSessionRevision()&&server===clientServerUrl()
 try{const result=await compatibilityChecker(JSON.stringify([scope,revision,server]),appInfo.version);if(current())compatibilityMessage.value=result.state==='supported'?`版本兼容检查通过；服务器最低客户端版本 ${result.minimumClientVersion}`:'服务器未提供版本兼容声明，当前按现有同步协议工作'}catch(source){if(current())compatibilityMessage.value=source instanceof Error?source.message:'兼容性检查失败，请检查网络'}finally{compatibilityBusy.value=false}
}
async function exportDiagnostic(){
 if(exporting.value)return;exporting.value=true;diagnosticMessage.value='';const scope=clientOwnerScope(props.ownerId)
 try{await refresh();if(scope!==clientOwnerScope(props.ownerId))throw Error('账号已切换，请重新导出');if(error.value)throw Error('附件队列尚未读完，请重新检查后导出');const report=buildSyncDiagnostic({version:appInfo.version,platform:isDesktopClient()?'desktop':'web',notes:[...store.notes,...store.archived,...store.trash],attachments:attachments.value,failedTasks:props.failedTasks,failedChanges:props.failedChanges||0,conflicts:props.conflicts,transport:syncTransportHealth.read(scope),mainQueue:inspection.value?.counts,queueSources:inspection.value?.sources});const saved=await saveLocalExport(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'note-flow-sync-diagnostic.json');if(scope===clientOwnerScope(props.ownerId))diagnosticMessage.value=saved?'脱敏诊断已导出':'已取消导出'}catch(source){if(scope===clientOwnerScope(props.ownerId))diagnosticMessage.value=source instanceof Error?source.message:'诊断导出失败'}finally{exporting.value=false}
}
const pendingNotes=computed(()=>[...store.notes,...store.archived,...store.trash].filter(note=>note.syncStatus==='pending').length)
const pendingAttachments=computed(()=>attachments.value.filter(item=>['pending','uploading','uploaded_needs_link'].includes(item.status)).length)
const failedAttachments=computed(()=>attachments.value.filter(item=>item.status==='failed').length)
const overviewCounts=computed(()=>{if(!inspection.value)return undefined;const counts={...inspection.value.counts};for(const source of inspection.value.sources||[])for(const key of Object.keys(counts) as Array<keyof typeof counts>)counts[key]+=source.counts[key];return counts})
const additionalAttention=computed(()=>inspection.value?.sources?.reduce((sum,source)=>sum+source.counts.rejected+source.counts.unknown+source.counts.conflicts,0)||0)
const needsAttention=computed(()=>additionalAttention.value+failedAttachments.value+(inspection.value?inspection.value.counts.rejected+inspection.value.counts.unknown+inspection.value.counts.conflicts:props.failedTasks+(props.failedChanges||0)+props.conflicts))
watch(()=>props.ownerId,()=>{attachments.value=[];inspection.value=null;diagnosticMessage.value='';compatibilityMessage.value='尚未检查客户端与服务器版本兼容性';void refresh()})
watch(()=>[props.failedTasks,props.failedChanges,props.conflicts],()=>{void refresh()})
watch(()=>syncActivity.running,(running,previous)=>{if(!running&&previous)void refresh()})
onMounted(()=>{window.addEventListener('note-flow:account-lifecycle-change',resetInspection);window.addEventListener('online',updateOnline);window.addEventListener('offline',updateOnline);void refresh();window.addEventListener('note-flow:workspace-change',refresh)})
onBeforeUnmount(()=>{window.removeEventListener('note-flow:account-lifecycle-change',resetInspection);window.removeEventListener('online',updateOnline);window.removeEventListener('offline',updateOnline);generation++;window.removeEventListener('note-flow:workspace-change',refresh)})
</script>
<template>
 <div class="sync-center">
  <SyncOverviewCard :connected="Boolean(connected)" :online="online" :busy="syncActivity.running>0" :checking="loading||inspectionBusy" :attention="needsAttention" :pending-notes="pendingNotes" :pending-attachments="pendingAttachments" :queue="overviewCounts" :queue-label="inspection?.sources?.length?'已检查队列待上传或重试':undefined" :coverage="inspection?.coverage" :inspection-error="Boolean(error)">
   <template #actions><ElButton :loading="loading" @click="refresh">重新检查</ElButton></template>
  </SyncOverviewCard>
  <LocalRestoreNotice/>
  <p v-if="error" role="alert">{{error}}</p>
  <p v-if="loading" role="status">正在检查本机上传与附件队列…</p>
  <ElButton v-if="pendingAttachments||failedAttachments" @click="router.push('/attachments')">查看待处理附件</ElButton>
  <section v-if="inspection?.sources?.length" class="sync-source-list" aria-label="独立同步队列"><h3>其他同步队列</h3><article v-for="source in inspection.sources" :key="source.key"><div><strong>{{source.label}}</strong><p>{{source.detail}}</p><small v-if="source.state==='checked'">待上传 {{source.counts.waiting+source.counts.retryable+source.counts.inFlight}} · 结果未确认 {{source.counts.unconfirmed}} · 被拒绝 {{source.counts.rejected}} · 冲突 {{source.counts.conflicts}}</small><small v-else>{{source.state==='unavailable'?'检查未完成':source.state==='local_only'?'仅本机保存':'未开启'}}</small></div><ElButton @click="router.push(source.route)">查看</ElButton></article></section>
  <slot name="issues"/>
  <details v-if="inspection?.records.length" class="sync-center-diagnostics">
   <summary>最近处理记录<span>重启后仍保留</span></summary>
   <div class="sync-center-diagnostic-body"><p>展示最近 50 份恢复档案中的处理记录；这是本机处理结果，不代表全部内容已同步。</p>
    <article v-for="record in inspection.records" :key="record.id" class="sync-action-record"><strong>{{record.label}}</strong><time>{{new Date(record.createdAt).toLocaleString('zh-CN')}}</time><p>{{record.detail}}</p><small v-if="record.operationId">原请求 {{record.operationId}}<template v-if="record.replacementOperationId"> → 新请求 {{record.replacementOperationId}}</template></small></article>
   </div>
  </details>
  <details class="sync-center-diagnostics">
   <summary>诊断详情<span>同步日志、检查记录与脱敏导出</span></summary>
   <div class="sync-center-diagnostic-body">
    <slot name="diagnostics"/>
    <p v-if="requestSummary.requests">近 30 天请求 {{requestSummary.requests}} 次，失败 {{requestSummary.failed}} 次，存在待处理操作 {{requestSummary.partial}} 次。这是历史请求统计，不代表当前待处理数量。</p>
    <p v-else>尚无同步请求统计；最多保留 30 天。</p>
    <p role="status">{{compatibilityMessage}}</p>
    <div class="sync-diagnostic-actions"><ElButton :disabled="!connected" :loading="compatibilityBusy" @click="checkCompatibility">检查版本兼容性</ElButton><ElButton :disabled="loading" :loading="exporting" @click="exportDiagnostic">导出脱敏诊断</ElButton></div>
    <p>导出仅包含版本、数量和请求统计，不含正文、标题、文件名、账号、服务器地址或原始错误。</p>
    <p v-if="diagnosticMessage" role="status">{{diagnosticMessage}}</p>
   </div>
  </details>
 </div>
</template>


<style scoped>
.sync-center-diagnostics{margin:16px 0;border:1px solid var(--pc-border);border-radius:10px;background:var(--pc-surface)}.sync-center-diagnostics>summary{cursor:pointer;padding:15px;font-size:14px;font-weight:600}.sync-center-diagnostics>summary span{margin-left:12px;font-size:12px;font-weight:400;color:var(--pc-muted)}.sync-center-diagnostic-body{padding:0 15px 15px}.sync-center-diagnostic-body p{font-size:12px;color:var(--pc-muted);line-height:1.7}.sync-diagnostic-actions{display:flex;flex-wrap:wrap;gap:8px}
.sync-action-record{padding:12px 0;border-bottom:1px solid var(--pc-border)}.sync-action-record strong{font-size:13px}.sync-action-record time{display:block;font-size:12px;color:var(--pc-muted);margin:5px 0}.sync-action-record small{font-size:11px;color:var(--pc-muted);overflow-wrap:anywhere}
.sync-source-list h3{font-size:14px;margin:18px 0 10px}.sync-source-list article{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--pc-border)}.sync-source-list article>div{flex:1;min-width:0}.sync-source-list strong{font-size:13px}.sync-source-list p,.sync-source-list small{font-size:12px;color:var(--pc-muted);line-height:1.6;margin:5px 0}.sync-source-list small{display:block}
</style>
