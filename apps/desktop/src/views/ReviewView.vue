<script setup lang="ts">
import {isCommunityEdition} from '../services/clientCapabilities'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { REVIEW_PERIOD_LABELS, REVIEW_PERIODS, parseReviewRouteQuery, reviewRouteQuery, seriesMatchesReview, type NoteEntity, type ProjectLogEntity, type ReviewPeriod, type ReviewScope } from '@note-flow/core'
import type {FocusSession} from '../services/localPersonal'
import {readFocusRecords} from '../services/focusRecordSource'
import { workspaceService, type AreaEntity, type JournalNoteEntity, type JournalSeriesEntity, type ProjectEntity, type ReportGenerationInfo } from '../services/workspace'
import { buildReviewEvents, calendarDate, expandedUtcRange, type ReviewEvent } from '../services/reviewData'
import { confirmDialog } from '../services/productDialog'
import { useNotesStore } from '../stores/notes'
import { useTasksStore } from '../stores/tasks'
import { TASKS_BACKGROUND_REFRESH_EVENT, taskNotesService, type TaskEntity } from '../services/tasks'
import { localDateKey, moveReviewAnchor, reviewPeriodTitle, validAnchor } from '../reviews/reviewWorkbench'
import { autonomousReviewContent, extractReviewPlanTasks, managedReviewBlock, replaceAutonomousReviewContent, reviewGenerationDiff } from '../reviews/reviewReport'
import PcDatePicker from '../components/PcDatePicker.vue'
import ReviewPeriodSummary from '../components/ReviewPeriodSummary.vue'
import ReviewMaterialBrowser from '../components/ReviewMaterialBrowser.vue'
import {childReviewSources, reviewSummaries, reviewGuides, reviewExcerpt} from '../reviews/reviewContent'
const MarkdownEditor=defineAsyncComponent(()=>import('../components/MarkdownEditor.vue'))
const MarkdownPreview=defineAsyncComponent(()=>import('../components/MarkdownPreview.vue'))
import { globalAreaUid } from '../services/globalAreaScope'

const route=useRoute(),router=useRouter(),notes=useNotesStore(),tasks=useTasksStore(),initial=parseReviewRouteQuery(route.query)
const initialScope:ReviewScope=globalAreaUid.value&&initial.scope.kind==='personal'&&!route.query.scope?{kind:'area',areaUid:globalAreaUid.value}:initial.scope
const period=ref<ReviewPeriod>(initial.period),anchor=ref(validAnchor(initial.anchor)),scope=ref<ReviewScope>(initialScope),seriesUid=ref(initial.seriesUid||'')
const areas=ref<AreaEntity[]>([]),projects=ref<ProjectEntity[]>([]),series=ref<JournalSeriesEntity[]>([]),logs=ref<ProjectLogEntity[]>([]),focuses=ref<FocusSession[]>([])
const loading=ref(true),error=ref(''),actionBusy=ref(false),timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'
const reportNote=ref<JournalNoteEntity>(),generation=ref<ReportGenerationInfo>(),diff=ref<{previous:string;next:string;changed:boolean}>(),reportPanel=ref(false),reportEditing=ref(false)
const reportDraft=ref({title:'',content:''})
const reportAutonomousContent=computed(()=>autonomousReviewContent(reportNote.value?.content||''))
const reportGeneratedContent=computed(()=>managedReviewBlock(reportNote.value?.content||''))
const dataScope=computed(()=>scope.value.kind==='personal'?{all:true}:scope.value.kind==='area'?{areaUid:scope.value.areaUid}:{areaUid:scope.value.areaUid,projectUid:scope.value.projectUid})
const timeline=computed(()=>buildReviewEvents({tasks:tasks.tasks,notes:notes.notes,logs:logs.value,focuses:focuses.value},{periodType:'daily',anchor:anchor.value,timezone,scope:dataScope.value}))
const periodEvents=computed(()=>period.value==='daily'?timeline.value:buildReviewEvents({tasks:tasks.tasks,notes:notes.notes,logs:logs.value,focuses:focuses.value},{periodType:period.value,anchor:anchor.value,timezone,scope:dataScope.value}))
const eventCount=(kind:ReviewEvent['kind'])=>timeline.value.filter(item=>item.kind===kind).length
const focusMinutes=computed(()=>Math.round(timeline.value.filter(item=>item.kind==='focus').reduce((sum,item)=>sum+(Number((item.source as FocusSession).actualSeconds)||0),0)/60))
const periodCount=(kind:ReviewEvent['kind'])=>periodEvents.value.filter(item=>item.kind===kind).length
const periodFocusMinutes=computed(()=>Math.round(periodEvents.value.filter(item=>item.kind==='focus').reduce((sum,item)=>sum+(Number((item.source as FocusSession).actualSeconds)||0),0)/60))
const eventLabel=(kind:ReviewEvent['kind'])=>({task_completed:'完成任务',note_created:'笔记活动',log_record:'日志',periodic_record:'周期记录',project_log:'项目进展',focus:'专注'} as const)[kind]
const matchingSeries=computed(()=>series.value.filter(item=>item.enabled!==false&&seriesMatchesReview(item,{period:period.value,anchor:anchor.value,scope:scope.value})))
const summaryEditor=ref<InstanceType<typeof ReviewPeriodSummary>>()
const seriesLoading=ref(true)
const summaries=computed(()=>reviewSummaries(notes.notes,period.value,anchor.value,scope.value).filter(note=>!seriesUid.value||note.journalSeriesUid===seriesUid.value))
const childSources=computed(()=>childReviewSources(notes.notes,period.value,anchor.value,scope.value))
const supportingEvents=computed(()=>periodEvents.value.filter(item=>item.kind!=='periodic_record'))
function rememberSeries(item:JournalSeriesEntity){if(!series.value.some(value=>value.uid===item.uid))series.value.push(item)}
function eventUrl(item:ReviewEvent){
  if(item.kind==='task_completed')return '/tasks?task='+encodeURIComponent(item.source.uid)
  if(item.kind==='project_log')return '/projects/'+encodeURIComponent((item.source as ProjectLogEntity).projectUid)+'/logs'
  if(item.kind==='log_record')return '/logs?date='+calendarDate(item.occurredAt,timezone)
  return '/notes?note='+encodeURIComponent(item.source.uid)
}
function addSource(note:NoteEntity){
  const sourceScope:ReviewScope=note.projectUid?{kind:'project',projectUid:note.projectUid,...(note.areaUid?{areaUid:note.areaUid}:{})}:note.areaUid?{kind:'area',areaUid:note.areaUid}:{kind:'personal'}
  const query=reviewRouteQuery({period:(note.periodType||'daily') as ReviewPeriod,anchor:note.periodStart||anchor.value,scope:sourceScope,seriesUid:note.journalSeriesUid||undefined})
  summaryEditor.value?.addReference(note.title,'/reviews?'+new URLSearchParams(query).toString())
}
function addEvent(item:ReviewEvent){summaryEditor.value?.addReference(item.title,eventUrl(item))}
function eventExcerpt(item:ReviewEvent){return 'content' in item.source?reviewExcerpt(String(item.source.content||'')):''}
const currentSeries=computed(()=>matchingSeries.value.find(item=>item.uid===seriesUid.value))
const areaName=(areaUid?:string)=>areas.value.find(item=>item.uid===areaUid)?.name
const scopeHint=computed(()=>{
  const current=scope.value
  if(current.kind==='personal') return '汇总所有领域、项目及未分类内容'
  if(current.kind==='area') return `仅汇总“${areaName(current.areaUid)||'当前领域'}”及其项目中的内容`
  const projectUid=current.projectUid
  return `仅汇总“${projects.value.find(item=>item.uid===projectUid)?.name||'当前项目'}”中的内容`
})
function annualYear(note:{title:string;periodStart?:string|null;createdAt?:string|null}){const periodYear=String(note.periodStart||'').match(/(?:19|20)\d{2}/)?.[0],full=note.title.match(/(?:19|20)\d{2}/)?.[0],short=note.title.match(/(?:^|\D)(\d{2})(?=\D|$)/)?.[1],createdYear=String(note.createdAt||'').match(/(?:19|20)\d{2}/)?.[0];return periodYear||full||(short?`20${short}`:createdYear||'未标年份')}
const selectedScope=computed({
  get:()=>scope.value.kind==='personal'?'personal':scope.value.kind==='area'?`area:${scope.value.areaUid}`:`project:${scope.value.projectUid}`,
  set:(value:string)=>{
    if(value==='personal') scope.value={kind:'personal'}
    else {
      const [kind,uid]=value.split(':')
      if(kind==='area') scope.value={kind:'area',areaUid:uid}
      else {
        const project=projects.value.find(item=>item.uid===uid)
        scope.value={kind:'project',projectUid:uid,...(project?{areaUid:project.areaUid}:{})}
      }
    }
    seriesUid.value=''
  }
})
const title=computed(()=>reviewPeriodTitle(anchor.value,period.value))
const periodCopy=computed(()=>({daily:['回顾这一天，看看自己留下的痕迹。','当日轨迹'],weekly:['回顾这一周，看看自己前进的方向。','本周概览'],monthly:['回顾这个月，整理阶段成果与沉淀。','本月概览'],quarterly:['回顾这个季度，校准目标与方向。','季度概览'],yearly:['回顾这一年，看见更完整的自己。','年度概览']} as const)[period.value])
const emptyCopy=computed(()=>currentSeries.value?`“${currentSeries.value.name}”在这个周期还没有内容。`:'当前范围没有可用的回顾系列。')
function setPeriod(value:ReviewPeriod){period.value=value;seriesUid.value=''}
function move(amount:number){anchor.value=moveReviewAnchor(anchor.value,period.value,amount)}
function today(){anchor.value=localDateKey()}
function syncRoute(){void router.replace({path:'/reviews',query:reviewRouteQuery({period:period.value,anchor:anchor.value,scope:scope.value,...(seriesUid.value?{seriesUid:seriesUid.value}:{})})})}
watch([period,anchor,scope,seriesUid],syncRoute,{deep:true})
watch(()=>route.query,query=>{const state=parseReviewRouteQuery(query);period.value=state.period;anchor.value=validAnchor(state.anchor);scope.value=state.scope;seriesUid.value=state.seriesUid||''},{deep:true})
watch(matchingSeries,values=>{if(!seriesUid.value||values.some(item=>item.uid===seriesUid.value))return;const requested=series.value.find(item=>item.uid===seriesUid.value);if(requested&&requested.periodType!=='once')period.value=requested.periodType;else if(series.value.length)seriesUid.value=''},{immediate:true})
function jump(path:string){void router.push(path)}
async function showReport(note:JournalNoteEntity,startEditing=false){reportNote.value=note;reportDraft.value={title:note.title,content:autonomousReviewContent(note.content||'')};reportEditing.value=startEditing;diff.value=undefined;const item=series.value.find(value=>value.uid===note.journalSeriesUid);generation.value=item?await workspaceService.reportGeneration(item.uid,note.uid).catch(()=>({noteUid:note.uid,seriesUid:item.uid,seriesName:item.name,sources:[]})):undefined;reportPanel.value=true}
function openSourceReport(note:NoteEntity){void showReport(note as JournalNoteEntity)}
function editReport(){if(!reportNote.value)return;reportDraft.value={title:reportNote.value.title,content:autonomousReviewContent(reportNote.value.content||'')};reportEditing.value=true}
async function saveReport(){const note=reportNote.value;if(!note||!reportDraft.value.title.trim())return;actionBusy.value=true;error.value='';try{const content=replaceAutonomousReviewContent(note.content||'',reportDraft.value.content),saved=await notes.updateEntity(note,{title:reportDraft.value.title.trim(),content});reportNote.value=saved as JournalNoteEntity;reportDraft.value={title:saved.title,content:autonomousReviewContent(saved.content||'')};reportEditing.value=false}catch(source){error.value=source instanceof Error?source.message:'回顾保存失败'}finally{actionBusy.value=false}}
function openTimelineEvent(item:ReviewEvent){if(item.kind==='periodic_record'&&(item.source as NoteEntity).periodType&&((item.source as NoteEntity).periodType!=='daily')){void showReport(item.source as JournalNoteEntity);return}if(item.kind==='periodic_record'||item.kind==='log_record'){void router.push({path:'/logs',query:{date:calendarDate(item.occurredAt,timezone)}});return}if(item.kind==='note_created'){jump(`/notes?note=${encodeURIComponent((item.source as {uid:string}).uid)}`);return}if(item.kind==='task_completed'){jump(`/tasks?task=${encodeURIComponent((item.source as {uid:string}).uid)}`);return}if(item.kind==='project_log'){const source=item.source as ProjectLogEntity;jump(`/projects/${encodeURIComponent(source.projectUid)}/logs`);return}const taskUid=(item.source as FocusSession).taskUid;jump(taskUid?`/tasks?task=${encodeURIComponent(taskUid)}`:'/focus')}
async function regenerate(){const note=reportNote.value,item=series.value.find(value=>value.uid===note?.journalSeriesUid);if(!item||!note||!await confirmDialog('重新汇总只会替换受管理的自动区块，手写正文会保留。继续吗？'))return;actionBusy.value=true;try{const saved=await workspaceService.regenerateReport(item.uid,note.uid,note.version);diff.value=reviewGenerationDiff(note.content,saved.content);reportNote.value=saved;notes.notes=notes.notes.map(value=>value.uid===saved.uid?{...value,...saved}:value);generation.value=await workspaceService.reportGeneration(item.uid,saved.uid)}catch(source){error.value=source instanceof Error?source.message:'重新汇总失败'}finally{actionBusy.value=false}}
async function createPlanTasks(){const note=reportNote.value;if(!note)return;const titles=extractReviewPlanTasks(note.content),marker=`来源回顾:${note.uid}`;const pending=titles.filter(title=>!tasks.tasks.some(task=>task.title===title&&task.description?.includes(marker)));if(!pending.length){error.value=titles.length?'下期计划已全部转换，无需重复创建':'“下期计划”中没有可转换的未完成事项';return}if(!await confirmDialog(`确认将 ${pending.length} 条下期计划创建为真实任务？`))return;actionBusy.value=true;try{for(const title of pending){const task=await tasks.create({title,description:marker,priority:0,areaUid:note.areaUid||null,projectUid:note.projectUid||null});await taskNotesService.link(task.uid,note.uid,'source')}error.value=`已创建并关联 ${pending.length} 条任务`}catch(source){error.value=source instanceof Error?source.message:'创建计划任务失败'}finally{actionBusy.value=false}}
const logsLoading=ref(false),focusLoading=ref(false)
let disposed=false,logRequest=0,focusRequest=0
function acceptBackgroundTasks(event:Event){const values=(event as CustomEvent<TaskEntity[]>).detail;if(Array.isArray(values))tasks.acceptBackgroundRefresh(values)}
onBeforeUnmount(()=>{disposed=true;logRequest++;focusRequest++;window.removeEventListener(TASKS_BACKGROUND_REFRESH_EVENT,acceptBackgroundTasks)})
async function loadReviewLogs(){
  const request=++logRequest,current=scope.value
  const ids=current.kind==='project'?[current.projectUid]:projects.value.filter(item=>current.kind!=='area'||item.areaUid===current.areaUid).map(item=>item.uid)
  logsLoading.value=true;logs.value=[]
  try{const values=await workspaceService.reviewLogs(ids);if(!disposed&&request===logRequest)logs.value=values}
  catch{if(!disposed&&request===logRequest)error.value='项目进展暂时无法加载，其他回顾数据仍可查看'}
  finally{if(!disposed&&request===logRequest)logsLoading.value=false}
}
async function loadReviewFocus(){
  const request=++focusRequest,{from,to}=expandedUtcRange(period.value,anchor.value)
  focusLoading.value=true;focuses.value=[]
  try{
    const result=await readFocusRecords(from,to),values=result.items
    if(!disposed&&request===focusRequest&&result.localOnly)error.value='云端专注记录暂不可用，当前专注数据仅来自本机。'
    if(!disposed&&request===focusRequest)focuses.value=values
  }catch{if(!disposed&&request===focusRequest)error.value='专注记录暂时无法加载，其他回顾数据仍可查看'}
  finally{if(!disposed&&request===focusRequest)focusLoading.value=false}
}
watch([scope,projects],()=>void loadReviewLogs(),{deep:true})
watch([period,anchor],()=>void loadReviewFocus())
onMounted(()=>{
  window.addEventListener(TASKS_BACKGROUND_REFRESH_EVENT,acceptBackgroundTasks)
  error.value=''
  void Promise.allSettled([notes.load(),tasks.load()]).then(()=>{if(!disposed){loading.value=false;if(notes.error||tasks.error)error.value=notes.error||tasks.error}})
  void workspaceService.areas().then(values=>{if(!disposed)areas.value=values}).catch(()=>{if(!disposed)error.value='领域加载失败'})
  void workspaceService.projects(undefined,true).then(values=>{if(!disposed)projects.value=values}).catch(()=>{if(!disposed)error.value='项目加载失败'})
  void workspaceService.series().then(values=>{if(!disposed)series.value=values}).catch(()=>{if(!disposed)error.value='回顾系列加载失败，请重新进入页面后再创建总结'}).finally(()=>{if(!disposed)seriesLoading.value=false})
  void loadReviewFocus()
})
</script>

<template><div class="page pc-review-page">
  <h1 class="workspace-page-heading">回顾</h1>
  <div class="review-toolbar"><nav aria-label="回顾周期"><button v-for="item in REVIEW_PERIODS" :key="item" :class="{active:period===item}" @click="setPeriod(item)">{{REVIEW_PERIOD_LABELS[item]}}</button></nav><div class="review-filters"><label><span>回顾范围</span><select v-model="selectedScope" :title="scopeHint"><option value="personal">我的全部内容</option><optgroup v-if="areas.length" label="按领域"><option v-for="area in areas.filter(item=>!item.archived)" :key="area.uid" :value="`area:${area.uid}`">领域 · {{area.name}}</option></optgroup><optgroup v-if="projects.length" label="按项目"><option v-for="project in projects.filter(item=>item.status!=='archived')" :key="project.uid" :value="`project:${project.uid}`">项目 · {{project.name}}{{areaName(project.areaUid)?`（${areaName(project.areaUid)}）`:''}}</option></optgroup></select></label><button v-if="period==='daily'" class="primary-action review-record pc-action pc-action--primary" @click="router.push({path:'/logs',query:{date:anchor}})">记录这一天 ›</button></div></div>
  <div class="review-period-nav"><button aria-label="上一个周期" @click="move(-1)">‹</button><strong>{{title}}</strong><button aria-label="下一个周期" @click="move(1)">›</button><button class="review-today pc-action pc-action--secondary" @click="today">今天</button><PcDatePicker v-model="anchor" helper="today" aria-label="选择回顾日期"/></div>
  <p v-if="logsLoading||focusLoading" class="review-state">正在补充项目进展和专注记录…</p><p v-if="error" class="review-state error">{{error}}</p><p v-if="loading" class="review-state">正在更新回顾数据，已有内容可先查看…</p>
  <section v-if="period==='daily'" class="review-dashboard"><div class="review-main"><section class="surface review-summary"><header><h2>{{periodCopy[1]}}</h2><small>按真实业务时间汇总</small></header><div class="review-stats"><article><strong>{{eventCount('task_completed')}}</strong><span>完成任务</span></article><article><strong>{{eventCount('note_created')+eventCount('periodic_record')}}</strong><span>新增笔记 / 周期记录</span></article><article><strong>{{focusMinutes}}</strong><span>专注分钟</span></article></div></section><section class="surface review-timeline"><h2>时间线</h2><p v-if="!timeline.length">当前日期暂无可信的轨迹记录。</p><article v-for="item in timeline" :key="item.uid" role="button" tabindex="0" @click="openTimelineEvent(item)" @keydown.enter.prevent="openTimelineEvent(item)" @keydown.space.prevent="openTimelineEvent(item)"><time>{{new Date(item.occurredAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}}</time><i/><div><small>{{eventLabel(item.kind)}}</small><strong>{{item.title}}</strong><p v-if="eventExcerpt(item)" class="review-source-excerpt">{{eventExcerpt(item)}}</p></div><b aria-hidden="true">›</b></article></section></div><aside class="surface review-series-panel"><h2>日记与日报</h2><p v-if="!matchingSeries.length">{{emptyCopy}}</p><button v-for="item in matchingSeries" :key="item.uid" :class="{active:seriesUid===item.uid}" @click="router.push({path:'/logs',query:{date:anchor}})"><span>{{item.name}}</span><small>前往日志查看 ›</small></button></aside></section>
  <section v-show="period!=='daily'" class="review-period-workbench">
    <div class="review-facts"><span>{{loading?'更新中…':title}}</span><span>完成任务 {{periodCount('task_completed')}}</span><span>新增笔记 {{periodCount('note_created')}}</span><span>日志 {{periodCount('log_record')+periodCount('project_log')}}</span><span>专注 {{periodFocusMinutes}} 分钟</span><small>仅供回忆，不代表成果或知识沉淀</small></div>
    <ReviewMaterialBrowser :period="period" :anchor="anchor" :scope-key="selectedScope" :notes="childSources" :events="supportingEvents" :timezone="timezone" :loading="loading||seriesLoading" @open-note="openSourceReport" @open-event="openTimelineEvent" @add-note="addSource" @add-event="addEvent" />
    <div class="review-content-layout">
      <ReviewPeriodSummary ref="summaryEditor" :period="period" :anchor="anchor" :scope="scope" :summaries="summaries" :series="matchingSeries" :loading="loading||seriesLoading" @series-created="rememberSeries" @details="openSourceReport" />
    </div>
  </section>
  <div v-if="reportPanel&&reportNote" class="review-report-overlay" @click.self="reportPanel=false"><section class="review-report-dialog review-report-document"><header><div><small>{{generation?.seriesName||'回顾总结'}} · {{annualYear(reportNote)}}</small><h2>{{reportEditing?'编辑自主总结':reportNote.title}}</h2></div><button class="pc-action pc-action--icon" aria-label="关闭" @click="reportPanel=false">×</button></header><div v-if="reportEditing" class="review-report-editor"><p>这里仅编辑你的自主总结，自动明细会被完整保留。</p><input v-model="reportDraft.title" aria-label="总结标题" placeholder="本期总结标题"><MarkdownEditor v-model="reportDraft.content" /></div><div v-else class="review-report-reading"><aside><h3>自动明细来源</h3><p>自主总结由你维护，系统重新汇总时不会覆盖。</p><span v-for="source in generation?.sources||[]" :key="source.uid"><b>{{source.sourceType}}</b>{{source.sourceLabel||source.sourceUid}}</span><p v-if="!generation?.sources.length">尚未生成自动明细。</p></aside><main><section class="review-autonomous-content"><small>自主总结</small><MarkdownPreview :content="reportAutonomousContent"/></section><details class="review-generated-details"><summary>自动汇总明细 <span>{{generation?.sources.length||0}} 项来源</span></summary><MarkdownPreview v-if="reportGeneratedContent" :content="reportGeneratedContent"/><p v-else>还没有生成自动明细，可点击下方按钮生成。</p></details><div v-if="diff" class="review-diff"><section><b>生成前</b><pre>{{diff.previous||'（空）'}}</pre></section><section><b>生成后</b><pre>{{diff.next||'（空）'}}</pre></section></div></main></div><footer v-if="reportEditing"><button class="pc-action pc-action--secondary" :disabled="actionBusy" @click="reportEditing=false">取消</button><button class="primary-action pc-action pc-action--primary" :disabled="actionBusy||!reportDraft.title.trim()" @click="saveReport">{{actionBusy?'保存中…':'保存自主总结'}}</button></footer><footer v-else><button class="pc-action pc-action--secondary" :disabled="actionBusy" @click="createPlanTasks">将下期计划转为任务</button><button class="pc-action pc-action--secondary" :disabled="actionBusy" @click="editReport">编辑自主总结</button><button v-if="reportNote.journalSeriesUid" class="primary-action pc-action pc-action--primary" :disabled="actionBusy" @click="regenerate">{{reportGeneratedContent?'更新自动明细':'生成自动明细'}}</button></footer></section></div>
</div></template>
<style scoped>.workspace-page-heading{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.pc-review-page .review-toolbar{margin-top:0;align-items:center;flex-wrap:wrap;gap:10px 18px}
.pc-review-page .review-filters{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.pc-review-page .review-filters label{display:flex;align-items:center;gap:7px}
.pc-review-page .review-record{min-height:32px;padding:6px 12px;font-size:11px;white-space:nowrap}
@media(max-width:620px){.pc-review-page .review-toolbar>nav{width:100%;grid-template-columns:repeat(5,minmax(0,1fr))}.pc-review-page .review-filters{width:100%;justify-content:space-between}.pc-review-page .review-filters label{flex:1;min-width:0}.pc-review-page .review-filters select{min-width:0}.pc-review-page .review-period-nav{justify-content:flex-start;flex-wrap:wrap;gap:6px}}
.pc-review-page{width:min(var(--pc-standard-width),100%);padding-top:18px}.review-report-document{width:min(1080px,100%)}.review-report-reading{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:480px}.review-report-reading>aside{display:grid;align-content:start;gap:8px;padding:20px;border-right:1px solid var(--pc-border);background:#f7faf8}.review-report-reading>aside h3{margin:0;font-size:12px}.review-report-reading>aside p{color:var(--pc-muted);font-size:9px;line-height:1.6}.review-report-reading>aside span{display:grid;gap:2px;padding:7px 0;border-bottom:1px solid #e5ebe7;font-size:8px}.review-report-reading>main{min-width:0;padding:28px 36px;overflow:auto}.review-autonomous-content>small{display:block;margin-bottom:14px;color:var(--pc-primary);font-size:9px;font-weight:700}.review-generated-details{margin-top:30px;padding-top:16px;border-top:1px solid var(--pc-border)}.review-generated-details summary{display:flex;justify-content:space-between;padding:10px 0;color:var(--pc-primary);font-size:11px;font-weight:700;cursor:pointer}.review-generated-details summary span{color:var(--pc-muted);font-size:9px;font-weight:500}.review-generated-details>p{padding:18px;color:var(--pc-muted);font-size:9px;text-align:center}.review-report-editor{display:grid;grid-template-rows:auto auto minmax(460px,1fr);gap:14px;padding:20px}.review-report-editor>p{margin:0;color:var(--pc-muted);font-size:9px}.review-report-editor>input{width:100%;padding:12px 14px;border:1px solid var(--pc-border);border-radius:8px;font:600 16px/1.4 inherit}.review-report-editor :deep(.markdown-editor){min-height:460px;border:1px solid var(--pc-border);border-radius:8px;overflow:hidden}</style>
<style scoped>
.review-content-layout{display:block;min-width:0}.review-facts{display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:12px 2px;color:var(--pc-muted);font-size:12px}.review-facts small{margin-left:auto}.review-reference-pane{display:grid;gap:16px;min-width:0}.review-materials{padding:18px}.review-materials header{display:flex;align-items:center;justify-content:space-between}.review-materials h2{font-size:15px;margin:0}.review-materials p,.review-source-excerpt{font-size:13px;line-height:1.7;color:var(--pc-muted);white-space:normal;overflow-wrap:anywhere}.review-materials small{display:block;color:var(--pc-muted);font-size:12px}.review-materials article{padding:14px 0;border-top:1px solid var(--pc-border)}.review-materials button{font-size:13px;padding:6px 9px;border:1px solid var(--pc-border);border-radius:6px;cursor:pointer}.review-materials .review-source-title{display:block;background:none;border:0;padding:6px 0;font-weight:600;text-align:left;white-space:normal;overflow-wrap:anywhere}.review-reference-pane{max-height:calc(100vh - 230px);overflow:auto}@media(max-width:1100px){.review-content-layout{grid-template-columns:1fr}.review-reference-pane{max-height:none}}
</style>
