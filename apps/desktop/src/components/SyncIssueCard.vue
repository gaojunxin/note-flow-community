<script setup lang="ts">
import {computed} from 'vue'
import type {SyncIssueKind,SyncActionFeedback} from '@note-flow/core/sync-presentation'
const props=defineProps<{title:string;entityLabel:string;category:SyncIssueKind;reason:string;busy?:boolean;feedback?:SyncActionFeedback}>()
const labels:Record<SyncIssueKind,string>={rejected:'上传被拒绝',conflict:'版本冲突',unconfirmed:'上传结果待确认',retryable:'上传暂未完成',unknown:'状态需检查'}
const label=computed(()=>labels[props.category]||labels.unknown)
</script>
<template>
 <article class="sync-issue-card" :aria-busy="busy" :aria-label="`${entityLabel}：${title}`">
  <header><strong>{{title}}</strong><span class="sync-issue-kind" :data-kind="category">{{label}}</span><small>{{entityLabel}}</small></header>
  <p class="sync-issue-reason">{{reason}}</p>
  <p v-if="feedback" class="sync-issue-feedback" :data-state="feedback.state" role="status">{{feedback.message}}</p>
  <div class="sync-issue-actions"><slot name="actions"/></div>
  <details v-if="$slots.diagnostics" class="sync-issue-details"><summary>技术详情</summary><div><slot name="diagnostics"/></div></details>
 </article>
</template>
<style scoped>
.sync-issue-card{min-width:0;padding:16px 0;border-top:1px solid var(--pc-border);color:var(--pc-text)}header{display:flex;align-items:center;flex-wrap:wrap;gap:8px}header strong{min-width:0;overflow-wrap:anywhere;font-size:14px}header small{color:var(--pc-muted);font-size:12px}.sync-issue-kind{padding:3px 7px;border-radius:5px;background:var(--pc-primary-soft);font-size:12px}.sync-issue-kind[data-kind=rejected],.sync-issue-kind[data-kind=unknown]{color:var(--pc-danger)}.sync-issue-reason,.sync-issue-feedback{margin:9px 0;font-size:13px;line-height:1.6;overflow-wrap:anywhere}.sync-issue-feedback{padding:8px 10px;background:var(--pc-primary-soft);border-radius:6px}.sync-issue-feedback[data-state=failed]{background:var(--pc-danger-soft,#fff1ef);color:var(--pc-danger,#a63d35)}.sync-issue-actions{display:flex;flex-wrap:wrap;gap:8px}.sync-issue-details{margin-top:12px;font-size:12px;color:var(--pc-muted)}summary{cursor:pointer;width:fit-content;padding:4px 0}.sync-issue-details>div{display:grid;justify-items:start;gap:7px;padding-top:8px;overflow-wrap:anywhere}@media(max-width:640px){.sync-issue-card{padding:14px 0}header strong{flex-basis:100%}}
</style>
