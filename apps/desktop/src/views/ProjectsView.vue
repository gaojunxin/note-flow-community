<script setup lang="ts">
import {saveLocalExport} from '../services/localFileExport'
import LogMarkdownDialog from '../components/LogMarkdownDialog.vue'
import ProjectLogBody from '../components/ProjectLogBody.vue'
import {registerLocalDraftGuard} from '../services/localDraftLifecycle'
import {onBeforeRouteLeave,onBeforeRouteUpdate} from 'vue-router'
import { confirmDialog } from '../services/productDialog'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { tasksService, taskDataScope, type TaskEntity } from '../services/tasks'
import { workspaceService, type AreaEntity, type JournalSeriesEntity, type ProjectEntity, type ProjectLogEntity, type ProjectMoveImpact } from '../services/workspace'
import { useNotesStore } from '../stores/notes'
import { isRegularNote, type JournalPeriodType, type NoteEntity } from '@note-flow/core'
import {matchesTaskScheduleFilter,effectiveTaskDate} from '../tasks/taskExperience'
import {currentRecurringTasks} from '@note-flow/core/task-recurrence'
import PcDatePicker from '../components/PcDatePicker.vue'
import { globalAreaUid } from '../services/globalAreaScope'

const route=useRoute(),router=useRouter(),areas=ref<AreaEntity[]>([]),projects=ref<ProjectEntity[]>([]),logs=ref<ProjectLogEntity[]>([]),tasks=ref<TaskEntity[]>([]),series=ref<JournalSeriesEntity[]>([])
const notesStore=useNotesStore()
const loading=ref(true)
const tasksLoading=ref(true)
const areaUid=globalAreaUid,tab=ref<'overview'|'tasks'|'notes'|'knowledge'|'logs'|'reviews'|'credentials'>('overview'),error=ref(''),newLog=ref('')
const logSaving=ref(false),logError=ref('')
const logsLoading=ref(false),logQuery=ref(''),logRange=ref<'all'|'week'|'month'>('all'),logType=ref<'all'|'progress'|'decision'|'risk'|'milestone'>('all'),newLogType=ref<'progress'|'decision'|'risk'|'milestone'>('progress')
const logEditorOpen=ref(false),logEditorBaseline=ref('')
const logEditorContent=computed({get:()=>editingLogUid.value?editingLogContent.value:newLog.value,set:(value:string)=>{if(editingLogUid.value)editingLogContent.value=value;else newLog.value=value}})
const editingLog=computed(()=>logs.value.find(log=>log.uid===editingLogUid.value))
const logEditorBusy=computed(()=>logSaving.value||!!logActionUid.value)
function newProjectLog(){editingLogUid.value='';logError.value='';logEditorBaseline.value=newLog.value;logEditorOpen.value=true}
function submitProjectLog(){if(editingLog.value)void saveLog(editingLog.value);else void addLog()}
const unregisterLogDraft=registerLocalDraftGuard({}, {dirty:()=>logEditorBusy.value||logEditorOpen.value&&logEditorContent.value!==logEditorBaseline.value,flush:async()=>{if(logEditorBusy.value||logEditorOpen.value&&logEditorContent.value!==logEditorBaseline.value)throw Error('项目日志尚未保存，请完成编辑后重试')}})
onBeforeUnmount(unregisterLogDraft)
async function guardLogNavigation(){if(logEditorBusy.value)return false;if(logEditorOpen.value&&logEditorContent.value!==logEditorBaseline.value){const discard=await confirmDialog({title:'项目日志尚未保存',message:'离开将丢弃尚未保存的修改。',confirmText:'放弃并离开',cancelText:'继续编辑'});if(!discard||logEditorBusy.value)return false;logEditorOpen.value=false;editingLogUid.value='';newLog.value=''}return true}
function protectLogExit(event:BeforeUnloadEvent){if(logEditorBusy.value||logEditorOpen.value&&logEditorContent.value!==logEditorBaseline.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',protectLogExit))
onBeforeUnmount(()=>window.removeEventListener('beforeunload',protectLogExit))
onBeforeRouteLeave(guardLogNavigation)
onBeforeRouteUpdate(guardLogNavigation)
const editingLogUid=ref(''),editingLogContent=ref(''),logActionUid=ref('')
const createOpen=ref(false),creating=ref(false),createError=ref('')
const moveOpen=ref(false),moveTargetAreaUid=ref(''),moveImpact=ref<ProjectMoveImpact|null>(null),moveBusy=ref(false),moveError=ref('')
const taskQuery=ref(''),taskStatus=ref<'today'|'next7'|'all'|'done'>('today')
const taskCreateOpen=ref(false),taskCreating=ref(false),taskCreateError=ref('')
const ProjectTaskDetails=defineAsyncComponent(()=>import('./TasksView.vue'))
const detailTaskUid=ref(''),taskDetailLoading=ref(false),taskDetailError=ref('')
function openTaskDetails(task:TaskEntity){if(detailTaskUid.value)return;taskDetailError.value='';taskDetailLoading.value=true;detailTaskUid.value=task.uid}
function closeTaskDetails(){
 detailTaskUid.value='';taskDetailLoading.value=false
 const scope=taskDataScope(),projectUid=route.params.projectUid
 void tasksService.list().then(values=>{if(scope===taskDataScope()&&projectUid===route.params.projectUid)tasks.value=values}).catch(()=>{if(scope===taskDataScope()&&projectUid===route.params.projectUid)taskDetailError.value='任务列表刷新失败，请重试'})
}
const taskDraft=ref({title:'',description:'',startAt:'',dueAt:'',priority:0,taskListId:null as number|null})
const projectStatus=ref<ProjectEntity['status']|'all'>('all')
const selectedSeriesUid=ref(''),reportAnchor=ref(new Date().toISOString().slice(0,10)),reportCreateOpen=ref(false),reportCreating=ref(false),reportOpening=ref(false),reportSourceSaving=ref(false),reportOpenError=ref('')
const reportDraft=ref({name:'项目周报',periodType:'weekly' as JournalPeriodType,includeTasks:true,includeNotes:true,includeLogs:true,includeFocus:false,includeChildReports:false})
const projectDraft=ref({name:'',areaUid:'',description:'',status:'active' as ProjectEntity['status'],targetDate:''})
const selected=computed(()=>projects.value.find(v=>v.uid===route.params.projectUid))
const visible=computed(()=>projects.value.filter(v=>(!areaUid.value||v.areaUid===areaUid.value)&&(projectStatus.value==='all'||v.status===projectStatus.value)))
const projectStatusOptions=[['active','进行中'],['planning','规划中'],['paused','已暂停'],['completed','已完成'],['archived','已归档'],['all','全部']] as const
const statusLabel=(status:ProjectEntity['status'])=>status==='active'?'进行中':status==='planning'?'规划中':status==='paused'?'已暂停':status==='completed'?'已完成':'已归档'
const projectTasks=computed(()=>tasks.value.filter(v=>v.projectUid===selected.value?.uid))
const projectStoredNotes=computed(()=>notesStore.notes.filter(v=>v.projectUid===selected.value?.uid))
const allProjectNotes=computed(()=>projectStoredNotes.value.filter(isRegularNote))
const projectNotes=computed(()=>allProjectNotes.value)
const reportSourceNotes=computed(()=>allProjectNotes.value)
const unfinished=computed(()=>projectTasks.value.filter(v=>!v.completed))
const overdueTasks=computed(()=>unfinished.value.filter(v=>v.dueAt&&new Date(v.dueAt).getTime()<Date.now()))
const taskDay=(task:TaskEntity)=>String(effectiveTaskDate(task)||'').slice(0,10)
const localDay=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const filteredProjectTasks=computed(()=>{
  const query=taskQuery.value.trim().toLocaleLowerCase(),scheduleFilter=taskStatus.value==='today'||taskStatus.value==='next7'?taskStatus.value:null
  // 日程入口与全局列表一致，只列顶层任务及重复系列的当前实例；其他页签保持既有范围。
  const candidates=scheduleFilter?currentRecurringTasks(tasks.value).filter(task=>task.projectUid===selected.value?.uid&&!task.parentTaskUid):projectTasks.value
  return candidates.filter(task=>{
    const inView=scheduleFilter?matchesTaskScheduleFilter(task,scheduleFilter):taskStatus.value==='done'?task.completed:!task.completed
    return inView&&(!query||`${task.title} ${task.description||''}`.toLocaleLowerCase().includes(query))
  }).sort((a,b)=>String(taskDay(a)||'9999').localeCompare(String(taskDay(b)||'9999')))
})
const upcomingTasks=computed(()=>unfinished.value.slice().sort((a,b)=>Number(!a.dueAt)-Number(!b.dueAt)||String(a.dueAt||'').localeCompare(String(b.dueAt||''))).slice(0,4))
const selectedSeries=computed(()=>series.value.find(v=>v.uid===selectedSeriesUid.value)||series.value[0])
const reportPeriod=computed(()=>periodBounds(selectedSeries.value?.periodType||'weekly',reportAnchor.value))
const reportHistory=computed(()=>projectStoredNotes.value.filter(note=>note.journalSeriesUid===selectedSeries.value?.uid).sort((a,b)=>String(b.periodStart||b.updatedAt||'').localeCompare(String(a.periodStart||a.updatedAt||''))))
const currentReport=computed(()=>reportHistory.value.find(note=>note.periodStart===reportPeriod.value.start))
const reportTaskCount=computed(()=>projectTasks.value.filter(task=>task.completedAt&&dateInside(task.completedAt,reportPeriod.value)).length)
const reportNoteCount=computed(()=>reportSourceNotes.value.filter(note=>note.journalSeriesUid!==selectedSeries.value?.uid&&note.updatedAt&&dateInside(note.updatedAt,reportPeriod.value)).length)
const reportLogCount=computed(()=>logs.value.filter(log=>dateInside(log.occurredAt,reportPeriod.value)).length)
const latestProjectUpdate=computed(()=>{
  const values=[...logs.value.map(v=>v.occurredAt),...allProjectNotes.value.map(v=>v.updatedAt)].filter(Boolean) as string[]
  return values.sort((a,b)=>String(b).localeCompare(String(a)))[0]
})
const logTypeOptions=[['progress','进展'],['decision','决策'],['risk','风险'],['milestone','里程碑']] as const
const logTypeLabel=(value:ReturnType<typeof projectLogType>)=>logTypeOptions.find(item=>item[0]===value)?.[1]||'进展'
function projectLogType(log:ProjectLogEntity):'progress'|'decision'|'risk'|'milestone'{const content=log.content.trim();if(/^\[?决策[\]：:]/.test(content))return'decision';if(/^\[?风险[\]：:]/.test(content))return'risk';if(/^\[?里程碑[\]：:]/.test(content))return'milestone';return'progress'}
const filteredLogs=computed(()=>{const query=logQuery.value.trim().toLocaleLowerCase(),now=new Date(),start=new Date(now);if(logRange.value==='week')start.setDate(now.getDate()-6);else if(logRange.value==='month')start.setDate(now.getDate()-29);return logs.value.filter(log=>(logType.value==='all'||projectLogType(log)===logType.value)&&(!query||log.content.toLocaleLowerCase().includes(query))&&(logRange.value==='all'||new Date(log.occurredAt)>=start))})
const groupedLogs=computed(()=>{const groups:Array<{day:string;label:string;logs:ProjectLogEntity[]}>=[];for(const log of filteredLogs.value){const day=logDay(log.occurredAt),current=groups.at(-1);if(current?.day===day)current.logs.push(log);else groups.push({day,label:logDayLabel(day),logs:[log]})}return groups})

async function load(){
  loading.value=true;tasksLoading.value=true;error.value=''
  const uid=String(route.params.projectUid||'')
  try{
    if(uid){const current=await workspaceService.project(uid);projects.value=current?[current]:[]}
    else projects.value=await workspaceService.projects(undefined,true)
  }catch(source){error.value=source instanceof Error?source.message:'项目加载失败'}
  finally{loading.value=false}
  void Promise.allSettled([
    workspaceService.areas().then(values=>{areas.value=values}),
    tasksService.list().then(values=>{tasks.value=values}).finally(()=>{tasksLoading.value=false}),
    notesStore.load(),
    uid?workspaceService.projects(undefined,true).then(values=>{projects.value=values}):Promise.resolve()
  ])
}
async function loadProject(){if(!selected.value)return;logsLoading.value=true;const [logResult,seriesResult]=await Promise.allSettled([workspaceService.logs(selected.value.uid),workspaceService.series({projectUid:selected.value.uid})]);if(logResult.status==='fulfilled')logs.value=logResult.value;else logError.value='项目日志加载失败，请稍后重试';if(seriesResult.status==='fulfilled')series.value=seriesResult.value;if(!series.value.some(v=>v.uid===selectedSeriesUid.value))selectedSeriesUid.value=series.value[0]?.uid||'';logsLoading.value=false}
function openCreate(){createError.value='';projectDraft.value={name:'',areaUid:areaUid.value||areas.value[0]?.uid||'',description:'',status:'active',targetDate:''};createOpen.value=true}
function closeCreate(){if(!creating.value)createOpen.value=false}
async function create(){const draft=projectDraft.value;if(!draft.name.trim()){createError.value='请输入项目名称';return}if(!draft.areaUid){createError.value='请选择项目所属领域';return}creating.value=true;createError.value='';try{const saved=await workspaceService.createProject({name:draft.name.trim(),areaUid:draft.areaUid,description:draft.description.trim()||undefined,status:draft.status,targetDate:draft.targetDate||undefined,progressMode:'task',sortOrder:projects.value.length});projects.value.push(saved);areaUid.value=draft.areaUid;createOpen.value=false;window.dispatchEvent(new Event('note-flow:workspace-change'));await router.push(`/projects/${saved.uid}/tasks`)}catch(source){createError.value=source instanceof Error?source.message:'项目创建失败'}finally{creating.value=false}}
async function setStatus(status:ProjectEntity['status']){if(!selected.value)return;if(status==='completed'&&unfinished.value.length&&!await confirmDialog(`项目还有 ${unfinished.value.length} 个未完成任务。仍要完成项目并保留这些任务以便整理吗？`))return;const saved=await workspaceService.updateProject(selected.value,{status});projects.value=projects.value.map(v=>v.uid===saved.uid?saved:v)}
function openMove(){if(!selected.value)return;moveOpen.value=true;moveTargetAreaUid.value='';moveImpact.value=null;moveError.value=''}
async function previewMove(){if(!selected.value||!moveTargetAreaUid.value)return;moveBusy.value=true;moveError.value='';try{moveImpact.value=await workspaceService.moveImpact(selected.value,moveTargetAreaUid.value)}catch(source){moveError.value=source instanceof Error?source.message:'无法获取迁移影响'}finally{moveBusy.value=false}}
async function confirmMove(){if(!selected.value||!moveImpact.value)return;moveBusy.value=true;moveError.value='';try{const result=await workspaceService.moveProject(selected.value,moveTargetAreaUid.value);if(result.project)projects.value=projects.value.map(item=>item.uid===result.project?.uid?result.project:item);areaUid.value=moveTargetAreaUid.value;moveOpen.value=false;window.dispatchEvent(new Event('note-flow:workspace-change'));await load();await loadProject();if(result.refreshWarning)error.value=result.refreshWarning}catch(source){moveError.value=source instanceof Error?source.message:'项目迁移失败，请检查实际状态后重试'}finally{moveBusy.value=false}}
async function toggleTask(task:TaskEntity){const saved=await tasksService.complete(task,!task.completed);tasks.value=tasks.value.map(v=>v.uid===saved.uid?saved:v)}
function openTaskCreate(){taskCreateError.value='';taskDraft.value={title:'',description:'',startAt:'',dueAt:'',priority:0,taskListId:null};taskCreateOpen.value=true}
async function createProjectTask(){if(!selected.value||!taskDraft.value.title.trim()||taskCreating.value)return;taskCreating.value=true;taskCreateError.value='';try{const saved=await tasksService.create({uid:crypto.randomUUID(),title:taskDraft.value.title.trim(),description:taskDraft.value.description.trim(),projectUid:selected.value.uid,areaUid:selected.value.areaUid,taskListId:taskDraft.value.taskListId,startAt:taskDraft.value.startAt?taskDraft.value.startAt.replace('T',' '):null,dueAt:taskDraft.value.dueAt?taskDraft.value.dueAt.replace('T',' '):null,priority:taskDraft.value.priority,completed:false,version:0});tasks.value.unshift(saved);taskCreateOpen.value=false}catch(source){taskCreateError.value=source instanceof Error?source.message:'任务创建失败'}finally{taskCreating.value=false}}
async function addLog(){
  const project=selected.value,content=newLog.value.trim()
  if(!project||!content||logSaving.value)return
  logSaving.value=true;logError.value=''
  try{const prefix=newLogType.value==='progress'?'':`[${logTypeOptions.find(item=>item[0]===newLogType.value)?.[1]}]\n\n`,saved=await workspaceService.createLog(project.uid,`${prefix}${content}`);logs.value.unshift(saved);newLog.value='';logEditorOpen.value=false;window.dispatchEvent(new Event('note-flow:project-log-change'))}
  catch(source){logError.value=source instanceof Error?source.message:'项目进展记录失败，请稍后重试'}
  finally{logSaving.value=false}
}
const logDay=(value:string)=>value.slice(0,10)
const logDayLabel=(value:string)=>new Date(`${value}T12:00:00`).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})
function editLog(log:ProjectLogEntity){logError.value='';editingLogUid.value=log.uid;editingLogContent.value=log.content;logEditorBaseline.value=log.content;logEditorOpen.value=true}
async function saveLog(log:ProjectLogEntity){const content=editingLogContent.value.trim();if(!content||logEditorBusy.value)return;logActionUid.value=log.uid;try{const saved=await workspaceService.updateLog(log,{content});logs.value=logs.value.map(item=>item.uid===saved.uid?saved:item);editingLogUid.value='';logEditorOpen.value=false}catch(source){logError.value=source instanceof Error?source.message:'日志保存失败'}finally{logActionUid.value=''}}
async function removeLog(log:ProjectLogEntity){if(!await confirmDialog('删除这条项目日志？删除后不会出现在项目回顾中。'))return;logActionUid.value=log.uid;try{await workspaceService.removeLog(log);logs.value=logs.value.filter(item=>item.uid!==log.uid)}catch(source){logError.value=source instanceof Error?source.message:'日志删除失败'}finally{logActionUid.value=''}}
async function logToTask(log:ProjectLogEntity){if(!selected.value)return;logActionUid.value=log.uid;try{const title=log.content.replace(/^\[[^\]]+\]\s*/,'').slice(0,120),saved=await tasksService.create({uid:crypto.randomUUID(),title,description:`来自项目日志：${log.content}`,projectUid:selected.value.uid,areaUid:selected.value.areaUid,priority:projectLogType(log)==='risk'?2:0,completed:false,version:0});tasks.value.unshift(saved)}catch(source){logError.value=source instanceof Error?source.message:'转为任务失败'}finally{logActionUid.value=''}}
async function openReport(item:JournalSeriesEntity){
  if(!selected.value||reportOpening.value)return
  reportOpening.value=true
  reportOpenError.value=''
  try{
    const note=await workspaceService.openJournal(item.uid,reportAnchor.value)
    await notesStore.acceptServer({...note,projectUid:selected.value.uid,journalSeriesUid:item.uid,syncStatus:'synced'} as NoteEntity)
    await router.push(`/projects/${selected.value.uid}/reports/${item.uid}/${note.uid}`)
  }catch(source){
    reportOpenError.value=source instanceof Error?source.message:'回顾生成失败，请稍后重试'
  }finally{
    reportOpening.value=false
  }
}
async function createReportSeries(){if(!selected.value||!reportDraft.value.name.trim())return;reportCreating.value=true;try{const saved=await workspaceService.createSeries({...reportDraft.value,name:reportDraft.value.name.trim(),projectUid:selected.value.uid,areaUid:selected.value.areaUid,kind:'project_report',enabled:true,sortOrder:series.value.length});series.value.push(saved);selectedSeriesUid.value=saved.uid;reportCreateOpen.value=false}catch(source){error.value=source instanceof Error?source.message:'回顾系列创建失败'}finally{reportCreating.value=false}}
async function updateReportSource(key:'includeTasks'|'includeNotes'|'includeLogs'|'includeFocus'|'includeChildReports',enabled:boolean){const current=selectedSeries.value;if(!current||reportSourceSaving.value)return;reportSourceSaving.value=true;reportOpenError.value='';try{const saved=await workspaceService.updateSeries(current,{[key]:enabled});series.value=series.value.map(item=>item.uid===saved.uid?saved:item)}catch(source){reportOpenError.value=source instanceof Error?source.message:'回顾来源设置保存失败'}finally{reportSourceSaving.value=false}}
function shiftReportPeriod(step:number){reportOpenError.value='';const type=selectedSeries.value?.periodType||'weekly',date=new Date(`${reportAnchor.value}T12:00:00`);if(type==='daily')date.setDate(date.getDate()+step);else if(type==='weekly')date.setDate(date.getDate()+step*7);else if(type==='monthly')date.setMonth(date.getMonth()+step);else date.setFullYear(date.getFullYear()+step);reportAnchor.value=date.toISOString().slice(0,10)}
function periodBounds(type:string,anchor:string){const date=new Date(`${anchor}T12:00:00`),start=new Date(date),end=new Date(date);if(type==='weekly'){const day=(date.getDay()+6)%7;start.setDate(date.getDate()-day);end.setDate(start.getDate()+6)}else if(type==='monthly'){start.setDate(1);end.setMonth(start.getMonth()+1,0)}else if(type==='yearly'||type==='annual'){start.setMonth(0,1);end.setMonth(11,31)}const iso=(value:Date)=>value.toISOString().slice(0,10);return{start:iso(start),end:iso(end),label:iso(start)===iso(end)?iso(start):`${iso(start)} ～ ${iso(end)}`}}
function dateInside(value:string,period:{start:string;end:string}){const date=value.slice(0,10);return date>=period.start&&date<=period.end}
function openTab(value:'overview'|'tasks'|'notes'|'knowledge'|'logs'|'reviews'|'credentials'){if(selected.value){if(value==='reviews'){router.push({path:'/reviews',query:{scope:'project',project:selected.value.uid}});return}router.push(`/projects/${selected.value.uid}/${value}`);return}tab.value=value}
async function exportProject(){if(!selected.value)return;const content=JSON.stringify({exportedAt:new Date().toISOString(),project:selected.value,tasks:projectTasks.value,logs:logs.value},null,2);await saveLocalExport(new Blob([content],{type:'application/json'}),`${selected.value.name}-项目归档.json`)}
watch(()=>route.params.projectUid,async()=>{logEditorOpen.value=false;editingLogUid.value='';newLog.value='';tab.value='overview';taskStatus.value='today';taskQuery.value='';await loadProject()})
watch(()=>route.name,()=>{const value=String(route.name||'').replace('project-','');if(['overview','tasks','logs','credentials'].includes(value))tab.value=value as 'overview'|'tasks'|'logs'|'credentials'},{immediate:true})
async function areaChanged(event:Event){areaUid.value=String((event as CustomEvent).detail||'');await load();await loadProject()}
async function workspaceChanged(){await load();await loadProject()}
function closeOnEscape(event:KeyboardEvent){if(event.key==='Escape')closeCreate()}
async function consumeCreateRequest(){if(route.query.create!=='1')return;await router.replace('/projects');openCreate()}
async function consumeProjectAction(){if(route.query.action!=='move'||!selected.value)return;await router.replace({path:route.path});openMove()}
watch(()=>route.query.request,async()=>{if(areas.value.length)await consumeCreateRequest()})
watch(()=>route.query.request,()=>{void consumeProjectAction()})
onMounted(async()=>{window.addEventListener('note-flow:area-change',areaChanged);window.addEventListener('note-flow:workspace-change',workspaceChanged);window.addEventListener('keydown',closeOnEscape);await load();await loadProject();await consumeCreateRequest();await consumeProjectAction()})
onBeforeUnmount(()=>{window.removeEventListener('note-flow:area-change',areaChanged);window.removeEventListener('note-flow:workspace-change',workspaceChanged);window.removeEventListener('keydown',closeOnEscape)})
</script>

<template>
  <div class="page projects-page" :class="{'project-selected':selected}">
    <section v-if="selected" class="project-detail">
      <header v-if="!route.params.projectUid"><div><small>项目中心 / {{areas.find(v=>v.uid===selected?.areaUid)?.name}}</small><h1>{{selected.name}}</h1><p>{{selected.description||'还没有项目说明'}}</p></div><div><button @click="router.push('/projects')">全部项目</button><button @click="openMove">移动领域</button><button @click="exportProject">导出归档</button><select :value="selected.status" @change="setStatus(($event.target as HTMLSelectElement).value as ProjectEntity['status'])"><option value="planning">规划中</option><option value="active">进行中</option><option value="paused">搁置</option><option value="completed">已完成</option></select></div></header>
      <div v-if="tab==='overview'" class="project-dashboard">
        <section class="project-brief"><div><h2>项目概览</h2><p>{{selected.description||'还没有项目说明'}}</p></div><p class="project-brief-meta"><span>{{statusLabel(selected.status)}}</span> · {{unfinished.length}} 个待办 · {{overdueTasks.length}} 个阻塞 · {{allProjectNotes.length}} 篇笔记<span v-if="selected.targetDate"> · 目标 {{selected.targetDate}}</span><span v-if="latestProjectUpdate"> · 更新于 {{new Date(latestProjectUpdate).toLocaleDateString('zh-CN')}}</span></p></section>
        <div class="project-workbench-grid"><section class="project-dashboard-card project-focus-card"><header><strong>当前重点</strong><button @click="openTab('tasks')">查看全部任务 →</button></header><p v-if="!upcomingTasks.length" class="project-card-empty">暂无待处理任务</p><button v-for="task in upcomingTasks" :key="task.uid" class="project-mini-task" @click="openTaskDetails(task)"><i/><span><b>{{task.title}}</b><small>{{task.dueAt?new Date(task.dueAt).toLocaleDateString('zh-CN'):'下一步行动'}}</small></span></button></section><section class="project-dashboard-card"><header><strong>项目资料</strong><button @click="openTab('notes')">查看全部笔记 →</button></header><p v-if="!projectNotes.length" class="project-card-empty">还没有项目笔记</p><button v-for="note in projectNotes.slice(0,5)" :key="note.uid" class="project-mini-note" @click="router.push({path:`/projects/${selected.uid}/notes`,query:{note:note.uid}})"><span>▤</span><b>{{note.title||'未命名笔记'}}</b><time>{{note.updatedAt?new Date(note.updatedAt).toLocaleDateString('zh-CN'):''}}</time></button></section><section class="project-dashboard-card project-progress-card"><header><strong>最近进展</strong><button @click="openTab('logs')">查看全部日志 →</button></header><p v-if="!logs.length" class="project-card-empty">还没有项目日志</p><article v-for="log in logs.slice(0,4)" :key="log.uid" class="project-mini-log"><time>{{new Date(log.occurredAt).toLocaleDateString('zh-CN')}}</time><p>{{log.content}}</p></article></section></div>
        <section class="project-dashboard-card project-risks"><header><strong>风险 / 待确认</strong><button @click="openTab('tasks')">查看任务 →</button></header><p v-if="!overdueTasks.length" class="project-card-empty positive">当前没有逾期或阻塞事项</p><article v-for="task in overdueTasks.slice(0,4)" :key="task.uid" class="project-risk-row"><span>阻塞</span><b>{{task.title}}</b></article></section>
      </div>
      <div v-else-if="tab==='tasks'" class="project-tasks-workspace">
        <header><button @click="openTaskCreate">＋ 新建项目任务</button><label>⌕ <input v-model="taskQuery" placeholder="搜索任务标题或描述…"/></label></header>
        <div class="project-task-filters"><button v-for="item in ([['today','今天'],['next7','未来 7 天'],['all','全部任务'],['done','已完成']] as const)" :key="item[0]" :class="{active:taskStatus===item[0]}" @click="taskStatus=item[0]">{{item[1]}}</button><small v-if="!tasksLoading">{{filteredProjectTasks.length}} 项任务</small></div>
        <div v-if="tasksLoading" class="project-task-loading" role="status" aria-live="polite"><i/><span><strong>正在加载项目任务</strong><small>正在读取当前项目的任务数据…</small></span></div>
        <p v-else-if="!filteredProjectTasks.length" class="project-card-empty">{{taskQuery?'没有匹配的任务':taskStatus==='today'?'今天没有安排任务':taskStatus==='next7'?'未来 7 天没有安排任务':taskStatus==='done'?'还没有已完成任务':'当前没有未完成任务'}}</p>
        <div v-else class="project-task-table"><header><span>任务标题</span><span>清单</span><span>截止日期</span><span>优先级</span><span>状态</span></header><article v-for="task in filteredProjectTasks" :key="task.uid" @click="openTaskDetails(task)"><button class="project-task-check" :class="{done:task.completed}" @click.stop="toggleTask(task)">{{task.completed?'✓':''}}</button><span><button type="button" class="project-task-title" @click.stop="openTaskDetails(task)">{{task.title}}</button><small>{{task.description||'暂无说明'}}</small></span><span>{{task.listName||'默认清单'}}</span><time :class="{late:!task.completed&&task.dueAt&&new Date(task.dueAt).getTime()<Date.now()}">{{task.dueAt?new Date(task.dueAt).toLocaleDateString('zh-CN'):task.startAt?new Date(task.startAt).toLocaleDateString('zh-CN'):'无日期'}}</time><span class="project-priority" :class="`p${task.priority}`">{{task.priority>=3?'高':task.priority===2?'中':task.priority===1?'低':'无'}}</span><span class="project-task-status" :class="{done:task.completed}">{{task.completed?'已完成':'进行中'}}</span></article></div>
      </div>
      <div v-else-if="tab==='logs'" class="project-logs project-log-workbench">
        <header class="project-log-heading"><div><h2>项目日志</h2><p>记录进展、决策、风险或里程碑</p></div><button type="button" class="project-log-add" @click="newProjectLog">＋ 新增项目日志</button></header><p v-if="logError" class="project-log-error" role="alert">{{logError}}</p>
        <LogMarkdownDialog v-model:open="logEditorOpen" v-model="logEditorContent" :title="editingLogUid?'编辑项目日志':'新增项目日志'" :busy="logEditorBusy" :error="logError" @save="submitProjectLog" @attachment-files="logError='项目日志暂不支持直接添加附件，可在项目笔记中保存文件后插入链接'"><p>{{selected.name}} · {{editingLog?new Date(editingLog.occurredAt).toLocaleString('zh-CN'):'新记录'}}</p><div v-if="!editingLogUid" class="project-log-types"><button v-for="item in logTypeOptions" :key="item[0]" :class="{active:newLogType===item[0]}" @click="newLogType=item[0]">{{item[1]}}</button></div></LogMarkdownDialog>
        <div class="project-log-toolbar"><label>⌕ <input v-model="logQuery" placeholder="搜索日志内容…"/></label><select v-model="logRange"><option value="all">全部时间</option><option value="week">最近 7 天</option><option value="month">最近 30 天</option></select><select v-model="logType"><option value="all">全部类型</option><option v-for="item in logTypeOptions" :key="item[0]" :value="item[0]">{{item[1]}}</option></select><small>{{filteredLogs.length}} 条</small></div>
        <section class="project-log-stream" aria-live="polite">
          <p v-if="logsLoading" class="project-card-empty">正在加载项目日志…</p>
          <p v-else-if="!logs.length" class="project-card-empty">还没有项目日志，记录第一条进展吧。</p>
          <p v-else-if="!filteredLogs.length" class="project-card-empty">当前筛选条件下没有日志。</p>
          <section v-for="group in groupedLogs" v-else :key="group.day" class="project-log-day"><header><strong>{{group.label}}</strong><span>{{group.logs.length}} 条记录</span></header><article v-for="log in group.logs" :key="log.uid" class="project-log-entry"><header class="project-log-entry-head"><div><time>{{new Date(log.occurredAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}}</time><span class="project-log-kind" :class="projectLogType(log)">{{logTypeLabel(projectLogType(log))}}</span></div><div class="project-log-entry-actions"><button type="button" @click="editLog(log)">编辑</button><details class="project-log-more"><summary aria-label="更多日志操作">更多 ···</summary><div class="pc-menu"><button class="pc-menu__item" type="button" @click="logToTask(log);($event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')">转为任务</button><button type="button" class="pc-menu__item danger" @click="($event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');removeLog(log)">删除日志</button></div></details></div></header><ProjectLogBody :key="log.uid" :content="log.content"/></article></section>
        </section>
      </div>
      <div v-else-if="tab==='reviews'" class="project-reports"><aside><header><strong>回顾系列</strong><button title="新建回顾系列" @click="reportCreateOpen=true">＋</button></header><p v-if="!series.length">还没有回顾系列</p><button v-for="item in series" :key="item.uid" :class="{active:selectedSeries?.uid===item.uid}" @click="selectedSeriesUid=item.uid"><span><b>{{item.name}}</b><small>{{item.periodType==='daily'?'每日':item.periodType==='weekly'?'每周':item.periodType==='monthly'?'每月':'周期回顾'}}</small></span><i>›</i></button></aside><section v-if="selectedSeries"><header class="project-report-head"><div><h2>{{selectedSeries.name}}</h2><p>{{reportPeriod.label}}</p></div><div><button @click="shiftReportPeriod(-1)">‹ 上一期</button><button @click="reportAnchor=new Date().toISOString().slice(0,10)">本期</button><button @click="shiftReportPeriod(1)">下一期 ›</button><button class="primary" @click="openReport(selectedSeries)">{{currentReport?'打开本期回顾':'生成本期回顾'}}</button></div></header><div class="report-material-summary"><strong>本期素材</strong><span><b>{{reportTaskCount}}</b> 已完成任务</span><span><b>{{reportNoteCount}}</b> 更新笔记</span><span><b>{{reportLogCount}}</b> 项目日志</span><span><b>{{overdueTasks.length}}</b> 风险阻塞</span></div><div class="report-source-card"><strong>回顾内容来源</strong><span :class="{off:!selectedSeries.includeTasks}">{{selectedSeries.includeTasks?'✓':'○'}} 已完成任务</span><span :class="{off:!selectedSeries.includeNotes}">{{selectedSeries.includeNotes?'✓':'○'}} 项目笔记</span><span :class="{off:!selectedSeries.includeFocus}">{{selectedSeries.includeFocus?'✓':'○'}} 专注记录</span><span :class="{off:!selectedSeries.includeChildReports}">{{selectedSeries.includeChildReports?'✓':'○'}} 子回顾</span></div><h3>历史回顾</h3><p v-if="!reportHistory.length" class="project-card-empty">这个系列还没有生成过回顾。</p><article v-for="note in reportHistory" :key="note.uid" class="project-report-row"><span><b>{{note.title}}</b><small>{{note.periodStart||'-'}} ～ {{note.periodEnd||'-'}} · {{note.updatedAt?new Date(note.updatedAt).toLocaleString('zh-CN'):''}}</small></span><button @click="router.push(`/projects/${selected.uid}/reports/${selectedSeries.uid}/${note.uid}`)">打开</button></article></section><section v-else class="project-report-empty"><h2>建立第一个回顾系列</h2><p>按日、周或月汇总项目进展，并保存为可继续编辑的 Markdown 笔记。</p><button @click="reportCreateOpen=true">新建回顾系列</button></section></div>
      <fieldset v-if="tab==='reviews'&&selectedSeries" class="report-source-options report-source-editor" :disabled="reportSourceSaving">
        <legend>回顾来源设置{{reportSourceSaving?' · 保存中…':''}}</legend>
        <label><input type="checkbox" :checked="selectedSeries.includeTasks!==false" @change="updateReportSource('includeTasks',($event.target as HTMLInputElement).checked)"/> 已完成任务与风险</label>
        <label><input type="checkbox" :checked="selectedSeries.includeNotes!==false" @change="updateReportSource('includeNotes',($event.target as HTMLInputElement).checked)"/> 项目笔记</label>
        <label><input type="checkbox" :checked="selectedSeries.includeLogs!==false" @change="updateReportSource('includeLogs',($event.target as HTMLInputElement).checked)"/> 项目日志</label>
        <label><input type="checkbox" :checked="selectedSeries.includeFocus!==false" @change="updateReportSource('includeFocus',($event.target as HTMLInputElement).checked)"/> 专注记录</label>
        <label><input type="checkbox" :checked="selectedSeries.includeChildReports!==false" @change="updateReportSource('includeChildReports',($event.target as HTMLInputElement).checked)"/> 子回顾</label>
      </fieldset>
      <p v-if="reportOpening" class="report-open-status" aria-live="polite">正在生成回顾…</p>
      <p v-else-if="reportOpenError" class="report-open-status error" role="alert">{{reportOpenError}}</p>
      <div v-if="reportCreateOpen" class="project-create-overlay" @click.self="reportCreateOpen=false"><form class="project-create-dialog report-series-dialog" @submit.prevent="createReportSeries"><header><div><span class="project-create-icon">▤</span><span><h2>新建回顾系列</h2><p>定义回顾周期和自动聚合的内容来源。</p></span></div><button type="button" @click="reportCreateOpen=false">×</button></header><div class="project-create-fields"><label class="project-name-field"><span>系列名称</span><input v-model="reportDraft.name" maxlength="80" placeholder="例如：项目周报"/></label><label><span>回顾周期</span><select v-model="reportDraft.periodType"><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label><fieldset class="report-source-options"><legend>内容来源</legend><label><input v-model="reportDraft.includeTasks" type="checkbox"/> 已完成任务与风险</label><label><input v-model="reportDraft.includeNotes" type="checkbox"/> 项目笔记</label><label><input v-model="reportDraft.includeLogs" type="checkbox"/> 项目日志</label><label><input v-model="reportDraft.includeFocus" type="checkbox"/> 专注记录</label><label><input v-model="reportDraft.includeChildReports" type="checkbox"/> 子回顾</label></fieldset></div><footer><button class="pc-action pc-action--secondary" type="button" @click="reportCreateOpen=false">取消</button><button class="primary pc-action pc-action--primary" :disabled="reportCreating">{{reportCreating?'正在创建…':'创建系列'}}</button></footer></form></div>
      <div v-if="moveOpen" class="project-create-overlay" @click.self="!moveBusy&&(moveOpen=false)"><form class="project-create-dialog" @submit.prevent="moveImpact?confirmMove():previewMove()"><header><div><span class="project-create-icon">⇄</span><span><h2>移动项目到其他领域</h2><p>项目和所有关联内容会在一个事务中迁移。</p></span></div><button type="button" :disabled="moveBusy" @click="moveOpen=false">×</button></header><div class="project-create-fields"><label><span>目标领域</span><select v-model="moveTargetAreaUid" @change="moveImpact=null;moveError=''" required><option disabled value="">请选择目标领域</option><option v-for="area in areas.filter(item=>item.uid!==selected?.areaUid&&!item.archived)" :key="area.uid" :value="area.uid">{{area.name}}</option></select></label><section v-if="moveImpact" class="project-move-impact"><strong>将随项目一起移动</strong><span>{{moveImpact.taskCount}} 个任务</span><span>{{moveImpact.noteCount}} 篇笔记</span><span>{{moveImpact.logCount}} 条日志</span><span>{{moveImpact.seriesCount}} 个周期系列</span><span>{{moveImpact.folderCount||0}} 个目录</span><span>{{moveImpact.taskListCount||0}} 个任务清单</span><p>目标领域：{{moveImpact.targetAreaName}}。迁移不会删除或归档内容。</p></section></div><p v-if="moveError" class="project-create-error">{{moveError}}</p><footer><button class="pc-action pc-action--secondary" type="button" :disabled="moveBusy" @click="moveOpen=false">取消</button><button class="primary pc-action pc-action--primary" :disabled="moveBusy||!moveTargetAreaUid">{{moveBusy?'处理中…':moveImpact?'确认移动':'查看影响'}}</button></footer></form></div>
    </section>
    <section v-else-if="route.params.projectUid&&loading" class="project-empty"><p>正在打开项目…</p></section>
    <section v-else-if="!route.params.projectUid" class="project-empty"><h1>选择一个项目</h1><p>集中管理任务、笔记、日志和周期回顾。</p><button @click="openCreate">新建项目</button></section>
    <p v-if="error" class="project-error">{{error}}</p>
    <div v-if="taskCreateOpen&&selected" class="pc-modal-backdrop" @click.self="!taskCreating&&(taskCreateOpen=false)"><form class="pc-task-dialog project-task-create-dialog" @submit.prevent="createProjectTask"><div class="section-heading"><div><h2>新建项目任务</h2><p>任务将归属当前项目和「{{areas.find(item=>item.uid===selected?.areaUid)?.name||'当前领域'}}」</p></div><button type="button" :disabled="taskCreating" @click="taskCreateOpen=false">×</button></div><label>任务标题<input v-model="taskDraft.title" autofocus maxlength="120" placeholder="要完成什么？"/></label><label>任务描述<textarea v-model="taskDraft.description" placeholder="可选：补充背景或交付标准"/></label><div class="dialog-grid"><label>计划时间<PcDatePicker v-model="taskDraft.startAt" include-time aria-label="选择计划时间" placeholder="选择计划时间"/></label><label>截止时间<PcDatePicker v-model="taskDraft.dueAt" include-time aria-label="选择截止时间" placeholder="选择截止时间"/></label><label>优先级<select v-model.number="taskDraft.priority"><option :value="0">无</option><option :value="1">中</option><option :value="2">高</option></select></label></div><p v-if="taskCreateError" class="task-detail-error">{{taskCreateError}}</p><div class="dialog-actions"><button class="pc-action pc-action--secondary" type="button" :disabled="taskCreating" @click="taskCreateOpen=false">取消</button><button class="primary-action pc-action pc-action--primary" :disabled="taskCreating||!taskDraft.title.trim()">{{taskCreating?'创建中…':'创建任务'}}</button></div></form></div>
    <div v-if="createOpen" class="project-create-overlay" role="presentation" @click.self="closeCreate">
      <form class="project-create-dialog" role="dialog" aria-modal="true" aria-labelledby="project-create-title" @submit.prevent="create">
        <header><div><span class="project-create-icon">▣</span><span><h2 id="project-create-title">新建项目</h2><p>为一项有明确结果的工作建立空间。</p></span></div><button class="pc-action pc-action--icon" type="button" aria-label="关闭" @click="closeCreate">×</button></header>
        <div class="project-create-fields">
          <label class="project-name-field"><span>项目名称</span><input v-model="projectDraft.name" autofocus maxlength="80" placeholder="例如：迹语 PC 端上线" /></label>
          <label><span>所属领域</span><select v-model="projectDraft.areaUid"><option disabled value="">请选择领域</option><option v-for="area in areas" :key="area.uid" :value="area.uid">{{area.name}}</option></select></label>
          <label><span>初始状态</span><select v-model="projectDraft.status"><option value="planning">规划中</option><option value="active">进行中</option><option value="paused">已暂停</option></select></label>
          <label><span>目标日期 <small>可选</small></span><PcDatePicker v-model="projectDraft.targetDate" aria-label="选择项目目标日期" placeholder="选择目标日期"/></label>
          <label class="project-description-field"><span>项目说明 <small>可选</small></span><textarea v-model="projectDraft.description" maxlength="500" placeholder="简要描述目标、范围或交付结果…" /></label>
        </div>
        <p v-if="createError" class="project-create-error">{{createError}}</p>
        <footer><button class="pc-action pc-action--secondary" type="button" @click="closeCreate">取消</button><button class="primary pc-action pc-action--primary" :disabled="creating||!areas.length">{{creating?'正在创建…':'创建项目'}}</button></footer>
      </form>
    </div>
  </div>
  <p v-if="taskDetailLoading" role="status" class="project-task-detail-feedback">正在读取任务详情…</p>
  <p v-if="taskDetailError" role="alert" class="project-task-detail-feedback">{{taskDetailError}}</p>
  <ProjectTaskDetails v-if="detailTaskUid" :key="detailTaskUid" details-only :detail-task-uid="detailTaskUid" @detail-close="closeTaskDetails" @detail-ready="taskDetailLoading=false" @detail-error="taskDetailError=$event"/>

</template>

<style scoped>
.project-dashboard{width:min(var(--pc-standard-width),100%);margin-inline:auto}.project-brief>div{display:none}
.project-log-workbench{width:min(900px,100%);margin:auto}.project-log-composer{padding:14px 16px!important}.project-log-composer textarea{min-height:105px!important}.project-log-composer footer{display:flex;align-items:center;justify-content:space-between}.project-log-composer footer small{color:var(--pc-muted);font-size:9px}.project-log-types{display:flex;gap:6px}.project-log-types button{padding:5px 10px;border:1px solid var(--pc-border);border-radius:999px;background:#fff;color:var(--pc-muted);font-size:9px}.project-log-types button.active{border-color:#a9cbb7;background:var(--pc-primary-soft);color:var(--pc-primary)}.project-log-toolbar{display:flex;align-items:center;gap:8px;margin-top:14px}.project-log-toolbar label{display:flex;min-width:180px;flex:1;gap:6px;padding:7px 9px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;color:var(--pc-muted)}.project-log-toolbar input{min-width:0;flex:1;border:0;outline:0}.project-log-toolbar select{padding:7px 9px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;color:var(--pc-text)}.project-log-toolbar>small{color:var(--pc-muted);font-size:9px}.project-log-stream{margin-top:10px}.project-log-day>header{display:flex;justify-content:space-between;padding:13px 4px 7px;border-bottom:1px solid var(--pc-border)}.project-log-day>header strong{font-size:10px}.project-log-day>header span{color:var(--pc-muted);font-size:8px}.project-log-day>article{display:grid;grid-template-columns:60px minmax(0,1fr);gap:14px;padding:14px 4px;border-bottom:1px solid #edf1ee}.project-log-day>article time{padding-top:4px;color:var(--pc-muted);font-size:9px}.project-log-day>article>div{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:7px}.project-log-day>article p{grid-column:2;margin:0;line-height:1.7;white-space:pre-wrap}.project-log-kind{grid-row:1;padding:3px 6px;border-radius:5px;background:#eaf3ed;color:#397052;font-size:8px}.project-log-kind.decision{background:#eeeafa;color:#654da0}.project-log-kind.risk{background:#fff0e5;color:#a15e22}.project-log-kind.milestone{background:#e8f2fb;color:#346d9b}.project-log-day article textarea{grid-column:2;min-height:84px;padding:8px;border:1px solid var(--pc-border);border-radius:7px;resize:vertical}.project-log-day article footer{display:flex;grid-column:2;justify-content:flex-end;gap:6px;opacity:0;transition:opacity .15s}.project-log-day article:hover footer,.project-log-day article.editing footer{opacity:1}.project-log-day article footer button{padding:5px 8px;border:1px solid var(--pc-border);border-radius:6px;background:#fff;color:var(--pc-muted);font-size:8px}.project-log-day article footer button.primary{border-color:var(--pc-primary);background:var(--pc-primary);color:#fff}.project-log-day article footer button.danger{color:#a34b45}.project-task-create-dialog .dialog-grid{grid-template-columns:1fr 1fr}.project-task-create-dialog .dialog-grid label:last-child{grid-column:1/-1}
.project-log-error{margin:0 0 8px!important;padding:8px 10px;border-radius:7px;background:#fff0f0;color:#a34242;font-size:10px}
.project-brief{padding:4px 2px 14px;border-bottom:1px solid var(--pc-border)}.project-brief h2{margin:0 0 6px;font-size:20px;font-weight:600}.project-brief p{margin:0;color:var(--pc-muted);font-size:11px}.project-brief-meta{margin-top:12px!important;color:#526158!important;font-size:10px!important}.project-brief-meta span:first-child{color:var(--pc-primary);font-weight:600}.project-workbench-grid{display:grid;grid-template-columns:1.15fr 1fr;gap:12px}.project-workbench-grid .project-dashboard-card{min-height:0}.project-focus-card{grid-row:span 2}.project-progress-card{grid-column:2}.project-risks{min-height:0}.project-risks>header{margin-bottom:4px}.project-risks .project-card-empty{padding:16px 8px}.project-focus-card .project-mini-task{padding:12px 2px}.project-focus-card .project-mini-task b{font-size:10px}.project-focus-card .project-mini-task small{font-size:9px}@media(max-width:760px){.project-workbench-grid{grid-template-columns:1fr}.project-focus-card{grid-row:auto}.project-progress-card{grid-column:auto}}
.project-log-markdown.is-collapsed{max-height:180px;overflow:hidden}.project-log-markdown{grid-column:2;min-width:0;overflow-wrap:anywhere}.project-log-day article:focus-within footer{opacity:1}.project-log-composer>small{margin-left:12px;color:var(--pc-muted)}

.project-log-workbench{width:min(1120px,100%);margin-inline:auto}.project-log-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 0 8px}.project-log-heading h2{margin:0;font-size:18px;color:var(--pc-text)}.project-log-heading p{margin:5px 0 0;color:var(--pc-muted);font-size:12px}.project-log-add{flex:none;display:inline-flex;align-items:center;min-height:36px;padding:0 14px;border:1px solid var(--pc-primary);border-radius:8px;background:var(--pc-primary);color:#fff;font:inherit;font-size:13px;cursor:pointer}.project-log-add:hover{filter:brightness(.94)}.project-log-toolbar{margin-top:10px;flex-wrap:wrap}.project-log-toolbar label{min-height:22px}.project-log-toolbar input,.project-log-toolbar select{font-size:13px}.project-log-toolbar>small{font-size:12px}.project-log-day>header{padding:22px 0 10px}.project-log-day>header strong{font-size:14px;color:var(--pc-text)}.project-log-day>header span{font-size:12px}.project-log-day>.project-log-entry{display:block;padding:18px 0;border-bottom:1px solid var(--pc-border)}.project-log-day>.project-log-entry>.project-log-body{display:block}.project-log-entry-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.project-log-entry-head>div{display:flex;align-items:center;gap:12px}.project-log-entry-head time{padding:0;font-size:12px;color:var(--pc-muted)}.project-log-entry-head .project-log-kind{font-size:11px;padding:3px 8px}.project-log-entry-actions>button,.project-log-more summary{padding:5px 9px;border:1px solid var(--pc-border);border-radius:6px;background:#fff;color:#53625a;font:inherit;font-size:12px;cursor:pointer}.project-log-entry-actions>button:hover,.project-log-more summary:hover{background:var(--pc-primary-soft);color:var(--pc-primary)}.project-log-more{position:relative}.project-log-more summary{list-style:none}.project-log-more summary::-webkit-details-marker{display:none}.project-log-more>div{position:absolute;z-index:10;right:0;top:calc(100% + 5px);width:128px;padding:5px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;box-shadow:0 8px 24px #1734261a}.project-log-more button{display:block;width:100%;padding:8px;border:0;border-radius:4px;background:transparent;text-align:left;color:var(--pc-text);font:inherit;font-size:12px;cursor:pointer}.project-log-more button:hover{background:#f4f7f5}.project-log-more button.danger{color:#a34b45}.project-log-workbench button:focus-visible,.project-log-more summary:focus-visible{outline:2px solid var(--pc-primary);outline-offset:2px}@media(max-width:650px){.project-log-heading{align-items:flex-start}.project-log-heading p{max-width:180px}.project-log-add{padding:0 10px;font-size:12px}.project-log-toolbar label{flex-basis:100%}}
.project-task-title{padding:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit;font-weight:600;cursor:pointer}.project-task-title:hover{text-decoration:underline}.project-task-title:focus-visible{outline:2px solid var(--pc-primary);outline-offset:3px}.project-task-detail-feedback{padding:8px 16px;color:var(--pc-muted)}

</style>
