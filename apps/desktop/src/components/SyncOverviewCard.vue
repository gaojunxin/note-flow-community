<script setup lang="ts">
import type {SyncQueueCounts} from '@note-flow/core/sync-presentation'
import {computed} from 'vue'
const props=defineProps<{connected:boolean;online:boolean;busy:boolean;checking?:boolean;attention:number;pendingNotes:number;pendingAttachments:number;queue?:SyncQueueCounts;coverage?:string;inspectionError?:boolean;queueLabel?:string}>()
const title=computed(()=>!props.connected?'尚未连接同步账号':!props.online?'当前离线':props.busy?'正在同步':props.checking?'正在检查本机状态':props.inspectionError?'本机队列检查未完成':props.attention?`${props.attention} 条记录需要处理`:props.queue&&(props.queue.waiting+props.queue.inFlight+props.queue.retryable+props.queue.unconfirmed)>0?'有内容等待上传或确认':'已检查范围内暂无待处理项')
</script>
<template>
 <section class="sync-overview" aria-label="当前同步概览" :aria-busy="busy">
  <header><div><h2>{{title}}</h2><p>{{!connected?'本机内容仍保存在当前设备。':!online?'本机修改会保留，联网后可继续同步。':'连接状态、上传进度和需要处理的事项分别展示。'}}</p></div><slot name="actions"/></header>
  <dl><div><dt>{{queue?(queueLabel||'主队列待上传或重试'):'已加载笔记待上传'}}</dt><dd>{{queue?queue.waiting+queue.retryable+queue.inFlight:pendingNotes}}</dd></div><div><dt>本机附件待上传或关联</dt><dd>{{pendingAttachments}}</dd></div><div><dt>需要处理的记录</dt><dd>{{attention}}</dd></div></dl>
  <p v-if="queue" class="sync-coverage">被服务器拒绝 {{queue.rejected}} · 结果未确认 {{queue.unconfirmed}} · 冲突 {{queue.conflicts}} · 状态待检查 {{queue.unknown}}</p>
  <p v-if="coverage" class="sync-coverage">检查范围：{{coverage}}</p>
  <p v-else class="sync-coverage">检查范围：已加载笔记、本机附件及已读取的失败和冲突记录。任务及其他内容的完整待上传队列尚未汇总，这里不代表所有内容均已同步。</p>
 </section>
</template>
<style scoped>
.sync-overview{padding:18px;border:1px solid var(--pc-border);border-radius:12px;background:var(--pc-surface);color:var(--pc-text);margin:14px 0}header{display:flex;gap:16px;align-items:start;justify-content:space-between}h2{font-size:17px;line-height:1.4;margin:0 0 6px}p{font-size:13px;line-height:1.6;margin:0;color:var(--pc-muted)}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}dl>div{padding:12px;background:var(--pc-primary-soft);border-radius:8px}dt{font-size:12px;color:var(--pc-muted)}dd{font-size:23px;font-weight:600;margin:8px 0 0}.sync-coverage{font-size:12px}@media(max-width:640px){header{flex-wrap:wrap}dl{grid-template-columns:1fr}dl>div{display:flex;justify-content:space-between;align-items:center}dd{margin:0;font-size:20px}}
</style>
