<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {ElButton,ElDrawer,ElInput,ElPagination,ElRadioButton,ElRadioGroup} from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/drawer/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/pagination/style/css'
import 'element-plus/es/components/radio-group/style/css'
import 'element-plus/es/components/radio-button/style/css'
import type {NoteEntity,ReviewPeriod} from '@note-flow/core'
import {calendarDate,type ReviewEvent} from '../services/reviewData'
import {reviewExcerpt,reviewGuides} from '../reviews/reviewContent'
import {autonomousReviewContent} from '../reviews/reviewReport'
import {periodIntroductions,reviewBuckets,type ReviewBucket} from '../reviews/reviewLayout'
const props=defineProps<{period:ReviewPeriod;anchor:string;scopeKey:string;notes:NoteEntity[];events:ReviewEvent[];timezone:string;loading:boolean}>()
const emit=defineEmits<{openNote:[note:NoteEntity];openEvent:[event:ReviewEvent];addNote:[note:NoteEntity];addEvent:[event:ReviewEvent]}>()
const opened=ref(false),query=ref(''),page=ref(1),tab=ref('summaries'),bucket=ref<ReviewBucket>()
const labels:Record<ReviewEvent['kind'],string>={task_completed:'完成任务',note_created:'笔记',log_record:'日志',periodic_record:'周期记录',project_log:'项目日志',focus:'专注'}
const buckets=computed(()=>reviewBuckets(props.period,props.anchor))
const noteInside=(note:NoteEntity,range?:ReviewBucket)=>!range||!!note.periodStart&&note.periodStart.slice(0,10)<=range.end&&(note.periodEnd||note.periodStart).slice(0,10)>=range.start
const datedEvents=computed(()=>props.events.map(event=>({event,date:calendarDate(event.occurredAt,props.timezone)})))
const bucketCards=computed(()=>buckets.value.map(range=>({...range,notes:props.notes.filter(note=>noteInside(note,range)).length,records:datedEvents.value.filter(item=>item.date>=range.start&&item.date<=range.end).length})))
const rows=computed(()=>{
  const search=query.value.trim().toLocaleLowerCase(),range=bucket.value
  if(tab.value==='summaries')return props.notes.filter(note=>noteInside(note,range)&&(!search||`${note.title} ${note.content}`.toLocaleLowerCase().includes(search))).map(note=>({key:note.uid,title:note.title,date:note.periodStart||'',label:'回顾记录',excerpt:reviewExcerpt(autonomousReviewContent(note.content)),note,event:undefined as ReviewEvent|undefined}))
  return datedEvents.value.filter(item=>(!range||item.date>=range.start&&item.date<=range.end)&&(!search||`${item.event.title} ${'content' in item.event.source?item.event.source.content:''}`.toLocaleLowerCase().includes(search))).map(({event,date})=>({key:event.uid,title:event.title,date,label:labels[event.kind],excerpt:'content' in event.source?reviewExcerpt(String(event.source.content||'')):'',note:undefined as NoteEntity|undefined,event}))
})
const visible=computed(()=>rows.value.slice((page.value-1)*8,page.value*8))
watch([query,tab,bucket],()=>page.value=1)
watch(()=>rows.value.length,length=>{page.value=Math.min(page.value,Math.max(1,Math.ceil(length/8)))})
watch(()=>[props.period,props.anchor,props.scopeKey],()=>{opened.value=false;bucket.value=undefined;query.value='';page.value=1})
function browse(type:string,range?:ReviewBucket){tab.value=type;bucket.value=range;query.value='';page.value=1;opened.value=true}
function reference(row:typeof visible.value[number]){if(row.note)emit('addNote',row.note);else if(row.event)emit('addEvent',row.event);opened.value=false}
function open(row:typeof visible.value[number]){opened.value=false;if(row.note)emit('openNote',row.note);else if(row.event)emit('openEvent',row.event)}
</script>

<template>
  <section class="surface period-lens" :class="`lens-${period}`">
    <header><div><small>{{reviewGuides[period].name}} · 回看线索</small><h2>{{periodIntroductions[period]}}</h2></div><div class="material-actions"><ElButton @click="browse('summaries')">{{reviewGuides[period].sources}} · {{notes.length}}</ElButton><ElButton @click="browse('records')">浏览素材 · {{events.length}}</ElButton></div></header>
    <div class="period-buckets">
      <button v-for="item in bucketCards" :key="item.start" @click="browse(period==='weekly'&&item.records?'records':'summaries',item)">
        <strong>{{item.label}}</strong><small>{{item.start.slice(5)}}{{item.end!==item.start?` — ${item.end.slice(5)}`:''}}</small>
        <p v-if="item.prompt">{{item.prompt}}</p><span>{{loading?'更新中…':period==='weekly'?`${item.records} 条素材`:`${item.notes} 篇回顾`}}</span><small v-if="period==='weekly'&&!loading">日记 / 日报 {{item.notes}}</small>
      </button>
    </div>
    <small class="material-tip">点击时间段查看材料；数量仅帮助查找，不代表成果。完整列表按需打开，不占用写作空间。</small>
    <ElDrawer v-model="opened" :title="bucket?`${bucket.label} · ${bucket.start} — ${bucket.end}`:'本期参考材料'" size="min(620px, 94vw)" append-to-body destroy-on-close>
      <div class="material-tools"><ElRadioGroup v-model="tab"><ElRadioButton value="summaries">回顾记录</ElRadioButton><ElRadioButton value="records">原始素材</ElRadioButton></ElRadioGroup><ElInput v-model="query" clearable placeholder="搜索标题或正文" aria-label="搜索回顾材料"/><ElButton v-if="bucket" text @click="bucket=undefined">取消时间段筛选</ElButton></div>
      <p class="material-status">{{rows.length}} 条 · 每页最多 8 条{{loading?' · 数据更新中…':''}}</p>
      <p v-if="!rows.length">{{loading?'正在加载材料…':'当前筛选下没有材料，可切换分类、清除筛选，或直接撰写总结。'}}</p>
      <article v-for="row in visible" :key="row.key" class="material-row"><small>{{row.date}} · {{row.label}}</small><button class="material-title" @click="open(row)">{{row.title}}</button><p v-if="row.excerpt">{{row.excerpt}}</p><ElButton v-if="row.event?.kind!=='focus'" size="small" :disabled="loading" @click="reference(row)">引用到总结</ElButton></article>
      <template #footer><ElPagination v-model:current-page="page" :page-size="8" :total="rows.length" layout="prev, pager, next" small/></template>
    </ElDrawer>
  </section>
</template>

<style scoped>
.period-lens{padding:20px;min-width:0}.period-lens header{display:flex;justify-content:space-between;gap:18px;align-items:center}.period-lens h2{font-size:17px;margin:5px 0 14px}.period-lens small,.material-row small,.material-status{color:var(--pc-muted);font-size:12px}.material-actions{display:flex;flex-wrap:wrap;gap:8px}.material-actions :deep(.el-button+.el-button){margin-left:0}.period-buckets{display:grid;gap:10px;margin:8px 0 14px}.period-buckets button{display:flex;flex-direction:column;gap:7px;text-align:left;padding:14px;border:1px solid var(--pc-border);border-radius:9px;background:var(--pc-surface,#fff);color:inherit;cursor:pointer;min-width:0}.period-buckets button:hover{border-color:var(--pc-primary);background:var(--pc-primary-soft)}.period-buckets strong{font-size:15px}.period-buckets span{font-size:12px;color:var(--pc-primary)}.period-buckets p{font-size:13px;color:var(--pc-muted);line-height:1.6;margin:5px 0}.lens-weekly .period-buckets{grid-template-columns:repeat(7,minmax(0,1fr))}.lens-weekly .period-buckets button{align-items:center;padding:12px 6px}.lens-monthly .period-buckets{grid-template-columns:repeat(auto-fit,minmax(135px,1fr))}.lens-monthly .period-buckets button{border-top:3px solid var(--pc-primary);border-radius:3px 3px 9px 9px}.lens-quarterly .period-buckets{grid-template-columns:repeat(3,minmax(0,1fr))}.lens-quarterly .period-buckets button{padding:20px}.lens-yearly .period-buckets{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px}.lens-yearly .period-buckets button{border:0;border-left:3px solid var(--pc-primary);border-radius:0;background:var(--pc-primary-soft);padding:14px 20px}.material-tip{display:block;line-height:1.7}.material-tools{display:grid;gap:12px}.material-row{padding:16px 0;border-bottom:1px solid var(--pc-border)}.material-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;max-width:100%;text-align:left;background:none;border:0;padding:7px 0;color:inherit;font-size:15px;font-weight:600;cursor:pointer;overflow-wrap:anywhere}.material-row p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--pc-muted);font-size:13px;line-height:1.7;margin:3px 0 10px}@media(max-width:900px){.period-lens header{display:block}.lens-weekly .period-buckets{grid-template-columns:repeat(4,minmax(0,1fr))}.lens-quarterly .period-buckets,.lens-yearly .period-buckets{grid-template-columns:1fr}}
</style>
