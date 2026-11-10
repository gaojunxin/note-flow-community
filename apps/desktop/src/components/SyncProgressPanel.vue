<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref} from 'vue'
import {syncActivity} from '../services/syncActivity'
defineProps<{alwaysVisible?:boolean}>()
const now=ref(Date.now());let timer:ReturnType<typeof setInterval>
onMounted(()=>{timer=setInterval(()=>{now.value=Date.now()},1000)});onBeforeUnmount(()=>clearInterval(timer))
const total=computed(()=>Number.isFinite(syncActivity.total)&&syncActivity.total>0?syncActivity.total:0)
const completed=computed(()=>Math.min(total.value,Math.max(0,syncActivity.completed||0)))
const elapsed=computed(()=>syncActivity.startedAt?Math.max(0,Math.floor(((syncActivity.finishedAt||now.value)-syncActivity.startedAt)/1000)):0)
const time=(at:number)=>new Date(at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})
</script>
<template>
  <section v-if="alwaysVisible||syncActivity.running||syncActivity.finishedAt||syncActivity.logs.length" class="sync-progress-panel">
    <div v-if="syncActivity.running" class="sync-live" role="status" aria-live="polite">
      <div class="sync-progress-heading"><strong>{{syncActivity.phase}}</strong><small>{{elapsed}} 秒</small></div>
      <p v-if="syncActivity.detail">{{syncActivity.detail}}</p>
      <progress v-if="total" :max="total" :value="completed" aria-label="当前同步阶段进度"/>
      <div v-else class="sync-indeterminate" role="progressbar" aria-label="正在同步，等待当前阶段完成"/>
      <small class="sync-stage-count">{{total?`${completed} / ${total} 项 · 当前阶段`:'正在处理，完成后自动更新'}}</small>
    </div>
    <p v-else-if="syncActivity.finishedAt" class="sync-last-result"><span>{{syncActivity.phase}}</span><small>耗时 {{elapsed}} 秒 · {{time(syncActivity.finishedAt)}}</small></p>
    <p v-if="alwaysVisible&&!syncActivity.logs.length" class="sync-empty" role="status"><strong>同步记录</strong><span>本次运行暂无同步记录。重启后记录会清空；没有变更的后台检查不写入这里。</span></p>
    <details v-if="syncActivity.logs.length" class="sync-log-list">
      <summary><span>同步记录<small>最近 {{syncActivity.logs.length}} 条</small></span><time>{{time(syncActivity.logs[0].at)}}</time><span class="sync-log-chevron">⌄</span></summary>
      <ol><li v-for="(log,index) in syncActivity.logs" :key="index" :class="{error:log.error}"><time>{{time(log.at)}}</time><span>{{log.message}}</span></li></ol>
    </details>
  </section>
</template>
<style scoped>

.sync-empty{display:grid;gap:8px;margin:0;padding:15px}.sync-empty strong{font-size:13px;font-weight:500}.sync-empty span{font-size:12px;color:var(--pc-muted);line-height:1.6}
.sync-progress-panel{min-width:0;margin:14px 0;border:1px solid var(--pc-border);border-radius:12px;background:var(--pc-surface);color:var(--pc-text);font-size:14px;overflow:hidden}.sync-live{padding:15px}.sync-progress-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.sync-progress-heading strong{font-size:14px;font-weight:600}.sync-progress-heading small,.sync-stage-count{color:var(--pc-muted);font-size:12px}.sync-live p{margin:7px 0 12px;font-size:12px;color:var(--pc-muted);line-height:1.6;overflow-wrap:anywhere}.sync-stage-count{display:block;margin-top:7px}.sync-progress-panel progress,.sync-indeterminate{display:block;appearance:none;width:100%;height:4px;margin:12px 0 0;border:0;border-radius:3px;overflow:hidden;background:var(--pc-primary-soft);accent-color:var(--pc-primary)}progress::-webkit-progress-bar{background:var(--pc-primary-soft);border-radius:3px}progress::-webkit-progress-value{background:var(--pc-primary);border-radius:3px}progress::-moz-progress-bar{background:var(--pc-primary);border-radius:3px}.sync-indeterminate:after{content:'';display:block;width:35%;height:100%;border-radius:3px;background:var(--pc-primary);animation:sync-travel 1.6s ease-in-out infinite}.sync-log-list{border-top:1px solid var(--pc-border)}.sync-log-list:first-child{border-top:0}.sync-log-list summary{display:flex;align-items:center;gap:10px;min-height:52px;padding:4px 15px;list-style:none;cursor:pointer}.sync-log-list summary::-webkit-details-marker{display:none}.sync-log-list summary>span:first-child{flex:1;font-size:13px;font-weight:500}.sync-log-list summary small{margin-left:8px;font-size:12px;color:var(--pc-muted);font-weight:400}.sync-log-list time{font-size:12px;color:var(--pc-muted);white-space:nowrap}.sync-log-chevron{color:var(--pc-muted)}.sync-log-list[open] .sync-log-chevron{transform:rotate(180deg)}.sync-log-list ol{max-height:240px;overflow:auto;list-style:none;margin:0;padding:0 15px 10px}.sync-log-list li{display:grid;grid-template-columns:40px minmax(0,1fr);gap:10px;padding:9px 0;border-top:1px solid var(--pc-border);font-size:12px;line-height:1.6;overflow-wrap:anywhere}.sync-log-list .error{color:var(--pc-danger,#a63d35)}.compact{margin:8px 0;border:0;background:transparent}.compact .sync-live{padding:0}.compact p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@keyframes sync-travel{0%{transform:translateX(-100%)}100%{transform:translateX(385%)}}@media(prefers-reduced-motion:reduce){.sync-indeterminate:after{animation:none;margin-left:30%}}
.sync-last-result{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0;padding:14px 15px;font-size:13px}.sync-last-result small{font-size:12px;color:var(--pc-muted)}.sync-log-list summary{min-height:44px}
</style>
