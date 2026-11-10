<script setup lang="ts">
import {accountLifecycleRevision} from '../services/accountStorage'
import {ElButton,ElDialog,ElSelect,ElOption} from 'element-plus'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/dialog/style/css'
import {openContextMenu,closeContextMenu,contextMenuState} from '../services/contextMenu'
import MoreIcon from '../components/MoreIcon.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import {clearInvalidLogCapture,LogCaptureValidationError,markLogCaptureCommitted,prepareLogCapture,readLogCapture,saveLogCapture,clearLogCapture,recoveredLogFiles,recoverLogNote,type LogCaptureJournal} from '../services/logCaptureJournal'
import {createLogCaptureOperation} from '../services/logCaptureOperation'
import {aiDataScope} from '../services/aiDataScope'
import {confirmDialog} from '../services/productDialog'
import {registerLocalDraftGuard} from '../services/localDraftLifecycle'
import { quickLogPeriodKey, isDailyJournal, reviewRouteQuery, type NoteEntity } from '@note-flow/core'
import { useNotesStore } from '../stores/notes'
import { useAuthStore } from '../stores/auth'
import { queueAttachment } from '../services/attachments'
import { workspaceService, type AreaEntity, type ProjectEntity, type ProjectLogEntity } from '../services/workspace'
import { tasksService, taskNotesService } from '../services/tasks'
import { noteLinksService } from '../services/noteLinks'
import { calendarDate, quickLogDay } from '../services/reviewData'
import { localDateKey, validAnchor } from '../reviews/reviewWorkbench'
import PcDatePicker from '../components/PcDatePicker.vue'
import MarkdownPreview from '../components/MarkdownPreview.vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import LogMarkdownDialog from '../components/LogMarkdownDialog.vue'
import { logsViewCache } from '../services/logsViewCache'
import { globalAreaUid } from '../services/globalAreaScope'

type Kind = 'work' | 'diary'
type Filter = 'all' | Kind
type TimelineItem =
  | { uid: string; at: string; day: string; type: 'quick'; note: NoteEntity }
  | { uid: string; at: string; day: string; type: 'journal'; note: NoteEntity }
  | { uid: string; at: string; day: string; type: 'legacy'; log: ProjectLogEntity }

const route = useRoute(), router = useRouter(), notes = useNotesStore(), auth = useAuthStore()
const navigator = window.navigator
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const jumpDate = ref(validAnchor(route.query.date as string)), filter = ref<Filter>('all')
const kind = ref<Kind>('work'), content = ref(''), projectUid = ref(typeof route.query.projectUid === 'string' ? route.query.projectUid : ''), loading = ref(!logsViewCache.loadedAt), busy = ref(false), error = ref('')
const query = ref(''), pendingFiles = ref<File[]>([]), fileInput = ref<HTMLInputElement>()
const dateJumped=ref(false),calendarOpen=ref(false),calendarPanel=ref<HTMLElement>()
type MarkdownEditorHandle={replaceSelection:(before:string,after?:string,placeholderText?:string)=>void;prefixLines:(prefix:string)=>void;setHeading:(level:number)=>void;focus:()=>void}
const menuUid = ref(''), editing = ref<NoteEntity>(), editDay=ref(''),editContent = ref(''), composer = ref<MarkdownEditorHandle>()
const detail = ref<TimelineItem>()
const expandedComposer=ref<MarkdownEditorHandle>()
const composerOpen=ref(false)
const editBusy=ref(false)
const projectTarget=ref<NoteEntity>(), selectedProjectUid=ref(''), projectBusy=ref(false), projectError=ref('')
const areas=ref<AreaEntity[]>([]), captureAreaUid=ref(globalAreaUid.value), selectedAreaUid=ref('')
const availableAreas=computed(()=>areas.value.filter(area=>!area.archived&&!area.deleted))
const areaName=(uid?:string|null)=>areas.value.find(area=>area.uid===uid)?.name||(uid?'原领域不可用':'未分类')
const associationProjects=computed(()=>projects.value.filter(project=>!['completed','archived'].includes(project.status)&&!project.deleted))
// 更换领域时解除不匹配的项目；选择项目时继承领域，避免保存矛盾归属。
function changeArea(uid:string,creating=false){
 const selected=creating?projectUid:selectedProjectUid
 if(projects.value.find(project=>project.uid===selected.value)?.areaUid!==uid)selected.value=''
 if(creating)captureAreaUid.value=uid;else selectedAreaUid.value=uid
}
function changeProject(uid:string,creating=false){
 const project=projects.value.find(project=>project.uid===uid)
 if(project){if(creating)captureAreaUid.value=project.areaUid;else selectedAreaUid.value=project.areaUid}
}
const currentLinkedProject=computed(()=>projects.value.find(item=>item.uid===projectTarget.value?.projectUid))
const projectChanged=computed(()=>Boolean(projectTarget.value&&(selectedProjectUid.value!==(projectTarget.value.projectUid||'')||selectedAreaUid.value!==(projectTarget.value.areaUid||''))))
let logsActive=true
const recovery=ref<LogCaptureJournal>(),recoveryReady=ref(false),recoveryReadFailed=ref(false),invalidRecovery=ref(false)
let capture:{operation:ReturnType<typeof createLogCaptureOperation<NoteEntity>>;text:string;files:File[];assertCurrent:()=>void}|undefined
const capturePending=ref(false)
const hasDraft=()=>Boolean(capturePending.value||content.value.trim()||pendingFiles.value.length||editing.value&&(editContent.value!==editing.value.content||editDay.value!==quickLogDay(editing.value,timezone)))
const unregisterDraft=registerLocalDraftGuard({}, {dirty:()=>busy.value||editBusy.value||projectBusy.value||hasDraft(),flush:async()=>{if(busy.value||editBusy.value||projectBusy.value||hasDraft())throw Error('日志仍有未保存内容，请先记录或完成编辑后重试')}})
onBeforeRouteLeave(async()=>{
 if(busy.value||editBusy.value||projectBusy.value){error.value='日志正在保存，请稍后再离开';return false}
 if(!hasDraft())return true
 const discard=await confirmDialog({title:'日志尚未保存',message:'离开会丢弃尚未保存的文字、编辑内容及已选附件。继续留在此页可以完成记录。',confirmText:'放弃并离开',cancelText:'继续记录',tone:'warning'})
 // A save may have started while the confirmation was open.
 if(!discard||busy.value||editBusy.value)return false
 if(recovery.value)await clearLogCapture(recovery.value.scope,recovery.value.operationUid)
 recovery.value=undefined;capture=undefined;capturePending.value=false;content.value='';pendingFiles.value=[];editing.value=undefined;editContent.value=''
 return true
})
const projects = ref<ProjectEntity[]>(logsViewCache.projects), oldLogs = ref<ProjectLogEntity[]>(logsViewCache.oldLogs)
const activeProjects = computed(() => projects.value.filter(item => (!captureAreaUid.value||item.areaUid===captureAreaUid.value)&&!['completed', 'archived'].includes(item.status)))
const quickKind = (note: NoteEntity): Kind => note.captureSource === 'quick_log_diary' ? 'diary' : 'work'
const projectName = (uid?: string | null) => projects.value.find(item => item.uid === uid)?.name || ''
const headline = (value: string) => value.trim().split(/\r?\n/)[0].replace(/^#+\s*/, '').slice(0, 60) || '未命名记录'
const dayLabel = (day: string) => { const date = new Date(`${day}T12:00:00`), calendar = date.toLocaleDateString('zh-CN', { year:'numeric',month: 'long', day: 'numeric' }), weekday = date.toLocaleDateString('zh-CN', { weekday: 'long' }); return `${day === localDateKey() ? '今天 · ' : day === localDateKey(new Date(Date.now() - 86400000)) ? '昨天 · ' : ''}${calendar} ${weekday}` }
const journalContent = (value: string) => {
  const lines = value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')
  while (lines[0]?.trim().startsWith('>')) lines.shift()
  while (lines[0]?.trim() === '') lines.shift()
  if (lines[0]?.trim() === '---') lines.shift()
  while (lines[0]?.trim() === '') lines.shift()
  return lines.join('\n').trim()
}
const placeholderLine = (line: string) => {
  const value = line.trim()
  if (!value || /^[-*_]{3,}$/.test(value) || /^(?:[-*+]\s*)?(?:\[[ xX]\]\s*)?$/.test(value) || /^\d+[.)]\s*$/.test(value)) return true
  const plain = value.replace(/^[-*+]\s*/, '').replace(/\*\*/g, '').trim()
  return /^(?:核心焦点|关联项目|今日成就|遇到的困难与解决方案|可以改进的地方|明日一击|今日评分|阻塞|明天重点)[：:]\s*(?:⭐️?){0,5}\s*(?:\(.*\))?$/.test(plain)
}
const cleanJournalMarkdown = (value: string) => {
  const body = journalContent(value).replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').trim()
  type Section = { heading: string; level: number; lines: string[]; children: Section[] }
  const root: Section = { heading: '', level: 0, lines: [], children: [] }, stack = [root]
  for (const line of body.split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!match) { stack[stack.length - 1].lines.push(line); continue }
    const node: Section = { heading: line, level: match[1].length, lines: [], children: [] }
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop()
    stack[stack.length - 1].children.push(node); stack.push(node)
  }
  const render = (section: Section): string => {
    const own = section.lines.filter(line => !placeholderLine(line)).join('\n').trim()
    const children = section.children.map(render).filter(Boolean)
    if (section !== root && !own && !children.length) return ''
    return [section.heading, own, ...children].filter(Boolean).join('\n\n').trim()
  }
  return render(root)
}
const contentSummary = (value: string) => {
  const plain = value.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/[*_>`~|]/g, '').replace(/\s+/g, ' ').trim()
  return plain.length > 180 ? `${plain.slice(0, 180).trimEnd()}…` : plain
}
const journalMeaningfulText = (value: string) => {
  let body = journalContent(value).replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
  body = body.replace(/```(?:dataview|dataviewjs)[\s\S]*?```/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  const structural = /^(?:今日TODO|工作记录|上午|下午|其他|复盘|任务|笔记|思考|🧭 今日导航|🎯 今日任务.*|🔴 今日到期.*|🟡 来自项目.*|📝 过程日志|关键进展\/问题|💡 闪念笔记.*|🌈 晚间复盘)$/
  return body.split('\n').map(line => line.trim()).filter(line => {
    if (!line || /^[-*_]{3,}$/.test(line)) return false
    const plain = line.replace(/^#{1,6}\s*/, '').trim()
    if (structural.test(plain) || /^(?:[-*+]\s*)?(?:\[[ xX]\]\s*)?$/.test(line) || /^\d+[.)]\s*$/.test(line)) return false
    const label = plain.replace(/^[-*+]\s*/, '')
    if (/^\*{0,2}(?:核心焦点|关联项目|今日成就|遇到的困难与解决方案|可以改进的地方|明日一击|今日评分|阻塞|明天重点)[：:]\*{0,2}\s*(?:⭐️?){0,5}\s*(?:\(.*\))?$/.test(label)) return false
    return !/^#?\s*\{\{date(?::[^}]*)?\}\}.*$/.test(plain)
  }).join('\n').trim()
}
const journalDay = (note: NoteEntity) => {
  const value = note.periodStart || note.createdAt || note.updatedAt || ''
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : calendarDate(value, timezone)
}

const timeline = computed<TimelineItem[]>(() => {
  const quick = notes.notes.filter(note => (!globalAreaUid.value||note.areaUid===globalAreaUid.value)&&note.type === 'work_log' && String(note.captureSource || '').startsWith('quick_log_') && (filter.value === 'all' || quickKind(note) === filter.value)).map(note => {
    const at = note.createdAt || note.updatedAt || ''
    return { uid: note.uid, at, day: quickLogDay(note,timezone), type: 'quick' as const, note }
  })
  const journals = notes.notes.filter(note => (!globalAreaUid.value||note.areaUid===globalAreaUid.value)&&isDailyJournal(note) && filter.value !== 'work').map(note => { const day=journalDay(note);return { uid: note.uid, at: note.createdAt || note.updatedAt || `${day}T00:00:00`, day, type: 'journal' as const, note } })
  const legacy = oldLogs.value.filter(log => (!globalAreaUid.value||log.areaUid===globalAreaUid.value)&&filter.value !== 'diary').map(log => ({ uid: log.uid, at: log.occurredAt, day: calendarDate(log.occurredAt, timezone), type: 'legacy' as const, log }))
  const keyword = query.value.trim().toLocaleLowerCase()
  return [...quick, ...journals, ...legacy].filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.day)).filter(item => !keyword || (item.type === 'legacy' ? item.log.content : `${item.note.title} ${item.note.content}`).toLocaleLowerCase().includes(keyword)).sort((a, b) => b.day.localeCompare(a.day)||b.at.localeCompare(a.at))
})
const tagsOf = (value: string) => [...value.matchAll(/(?:^|\s)#([^\s#]+)/g)].map(match => match[1]).slice(0, 4)
const cleanContent = (value: string) => value.replace(/(?:^|\s)#[^\s#]+/g, '').replace(/\s{2,}/g, ' ').trim()
const dayCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of timeline.value) counts.set(item.day, (counts.get(item.day) || 0) + 1)
  return counts
})
const countForDay = (day: string) => dayCounts.value.get(day) || 0
const scrollContainer = ref<HTMLElement | null>(null)
const ownerId = () => String(auth.user?.userId || '')
const detailTitle = computed(() => !detail.value ? '' : detail.value.type === 'legacy' ? '历史项目日志' : detail.value.note.title || headline(detail.value.note.content))
const detailContent = computed(() => !detail.value ? '' : detail.value.type === 'legacy' ? detail.value.log.content : detail.value.type === 'journal' ? cleanJournalMarkdown(detail.value.note.content) : detail.value.note.content)
const detailKind = computed(() => !detail.value ? '' : detail.value.type === 'journal' ? '日记' : detail.value.type === 'legacy' ? '历史项目日志' : quickKind(detail.value.note) === 'diary' ? '日记' : '工作日志')
const detailProject = computed(() => !detail.value ? '' : detail.value.type === 'legacy' ? projectName(detail.value.log.projectUid) : projectName(detail.value.note.projectUid))
const monthLabel=computed(()=>new Date(`${jumpDate.value}T12:00:00`).toLocaleDateString('zh-CN',{year:'numeric',month:'long'}))
const selectedMonth=computed(()=>jumpDate.value.slice(0,7))
const logDays=computed(()=>{const days=new Set<string>();for(const note of notes.notes){if(globalAreaUid.value&&note.areaUid!==globalAreaUid.value)continue;if(note.type==='work_log'&&String(note.captureSource||'').startsWith('quick_log_'))days.add(quickLogDay(note,timezone));else if(isDailyJournal(note))days.add(journalDay(note))}for(const log of oldLogs.value)if(!globalAreaUid.value||log.areaUid===globalAreaUid.value)days.add(calendarDate(log.occurredAt,timezone));return days})
const calendarDays=computed(()=>{const anchor=new Date(`${jumpDate.value.slice(0,7)}-01T12:00:00`),year=anchor.getFullYear(),month=anchor.getMonth(),start=new Date(year,month,1);start.setDate(start.getDate()-start.getDay());return Array.from({length:42},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);const day=localDateKey(date);return{day,number:date.getDate(),currentMonth:date.getMonth()===month,hasLog:logDays.value.has(day),today:day===localDateKey()}})})
const timelineKind=(item:TimelineItem)=>item.type==='legacy'?'project':item.type==='journal'||quickKind(item.note)==='diary'?'diary':'work'
const timelineKindLabel=(item:TimelineItem)=>timelineKind(item)==='diary'?'日记':timelineKind(item)==='project'?'项目日志':'工作日志'
const timelineTimeLabel=(item:TimelineItem)=>`${item.day.slice(0,4)} · ${item.type==='journal'?'全天':new Date(item.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`
async function openComposer(){composerOpen.value=true;await nextTick();expandedComposer.value?.focus()}
function addPendingFiles(files:File[]){if(!busy.value)pendingFiles.value=[...pendingFiles.value,...files]}

function addTag(){const target=composerOpen.value?expandedComposer.value:composer.value;target?.replaceSelection('', '', '#标签');target?.focus()}
function scrollTop() { scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' }) }
function chooseFiles(event: Event) { pendingFiles.value = [...((event.target as HTMLInputElement).files || [])] }

function append(note: NoteEntity) { notes.notes = [note, ...notes.notes.filter(item => item.uid !== note.uid)] }
function closeFloating(event?:Event) { menuUid.value = '';if(!event||!calendarPanel.value?.contains(event.target as Node))calendarOpen.value=false }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') { if(composerOpen.value||editing.value)return;if (detail.value) detail.value = undefined; else closeFloating() } }
function setFilter(value: Filter) { filter.value = value }
async function jumpToDate() { await nextTick(); document.getElementById(`log-day-${jumpDate.value}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
async function jumpToMonth() { await nextTick(); document.querySelector<HTMLElement>(`[id^="log-day-${selectedMonth.value}"]`)?.scrollIntoView({ behavior:'smooth',block:'start' }) }
async function backToday() { dateJumped.value=false; jumpDate.value = localDateKey(); await jumpToMonth() }
function browseCalendarMonth(step:number){const date=new Date(`${jumpDate.value}T12:00:00`);date.setMonth(date.getMonth()+step,1);jumpDate.value=localDateKey(date)}
async function selectCalendarDay(day:string){dateJumped.value=true;jumpDate.value=day;calendarOpen.value=false;await jumpToDate()}

async function loadLegacyLogs(values: ProjectEntity[]) {
  const results = await Promise.allSettled(values.filter(item => item.status !== 'archived').map(item => workspaceService.logs(item.uid)))
  oldLogs.value = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  logsViewCache.oldLogs = oldLogs.value
}
async function load(background = false) {
  if (!background) loading.value = true
  error.value = ''
  try {
    const refreshNotes=async()=>{if (notes.syncEnabled()) await notes.runSync();else await notes.load()}
    const [, nextProjects] = await Promise.all([refreshNotes(), workspaceService.projects(undefined, true)])
    projects.value = nextProjects
    logsViewCache.projects = nextProjects
    logsViewCache.loadedAt = Date.now()
    void loadLegacyLogs(nextProjects)
  } catch (source) { error.value = source instanceof Error ? source.message : '日志加载失败' }
  finally { if (!background) loading.value = false }
}
function bindRecovery(row:LogCaptureJournal,files:File[],owner:string){
 const service=notes.service(),scope=aiDataScope(),revision=accountLifecycleRevision()
 const assertCurrent=()=>{if(!logsActive||revision!==accountLifecycleRevision()||scope!==aiDataScope()||row.scope!==scope||owner!==ownerId())throw Error('账号或空间已切换，已停止日志附件写入')}
 return {text:row.text,files,assertCurrent,operation:createLogCaptureOperation({files,operationUids:row.files.map(file=>file.uid),create:async()=>{const saved=await readLogCapture(row.scope);assertCurrent();if(!saved||saved.operationUid!==row.operationUid)throw Error('日志恢复记录已改变，请重新加载');const note=await recoverLogNote(saved,service,assertCurrent);await markLogCaptureCommitted(row.scope,row.operationUid);assertCurrent();return note},enqueue:(note,file,operationUid)=>queueAttachment(owner,note.uid,file,operationUid),assertCurrent})}
}
async function restoreCapture(){
 const scope=aiDataScope(),revision=accountLifecycleRevision(),current=()=>logsActive&&scope===aiDataScope()&&revision===accountLifecycleRevision()
 try{const row=await readLogCapture(scope);if(!current())return;recoveryReadFailed.value=false;invalidRecovery.value=false;error.value='';recovery.value=row;capture=undefined;capturePending.value=false;if(row){captureAreaUid.value=row.input.areaUid||'';projectUid.value=row.input.projectUid||'';capture=bindRecovery(row,recoveredLogFiles(row),ownerId());capturePending.value=true}}catch(source){if(current()){recoveryReadFailed.value=true;invalidRecovery.value=source instanceof LogCaptureValidationError;error.value=source instanceof Error?source.message:'日志恢复记录读取失败'}}finally{if(current())recoveryReady.value=true}
}
async function discardInvalidRecovery(){
 if(busy.value||!invalidRecovery.value)return
 const scope=aiDataScope(),revision=accountLifecycleRevision()
 if(!await confirmDialog({title:'放弃损坏的恢复记录',message:'仅清除本机无法继续处理的恢复记录及其中的附件副本，可能丢失尚未保存的内容。已经创建的日志和已经入队的附件会保留。',confirmText:'放弃损坏记录',cancelText:'保留',tone:'warning'}))return
 if(!logsActive||scope!==aiDataScope()||revision!==accountLifecycleRevision())return
 busy.value=true
 try{if(!await clearInvalidLogCapture(scope))throw Error('本机已有有效恢复记录，请重新读取后继续');await restoreCapture()}catch(source){if(logsActive&&scope===aiDataScope())error.value=source instanceof Error?source.message:'恢复记录清理失败'}finally{if(logsActive)busy.value=false}
}

async function discardRecovery(){
 const row=recovery.value;if(!row||busy.value)return
 if(!await confirmDialog({title:'放弃未完成日志',message:'仅清除本次恢复记录和其中尚未入队的附件；已经保存的正文及附件会保留。',confirmText:'放弃恢复',cancelText:'保留',tone:'warning'}))return
 if(busy.value||recovery.value?.operationUid!==row.operationUid||row.scope!==aiDataScope())return
 try{await clearLogCapture(row.scope,row.operationUid);recovery.value=undefined;capture=undefined;capturePending.value=false}catch(source){error.value=source instanceof Error?source.message:'清除恢复记录失败'}
}
async function save() {
 if(busy.value||!recoveryReady.value||recoveryReadFailed.value||!capture&&!content.value.trim())return
 busy.value=true;error.value=''
 try{
  if(!capture){
   const project=projects.value.find(item=>item.uid===projectUid.value),text=content.value,files=[...pendingFiles.value],owner=ownerId(),scope=aiDataScope()
   if(files.length&&!owner)throw Error('请先登录后添加附件')
   const input={uid:crypto.randomUUID(),title:headline(text),content:text.trim(),type:'work_log' as const,status:'active' as const,organizationStatus:'pending' as const,captureSource:`quick_log_${kind.value}`,projectUid:project?.uid||null,areaUid:project?.areaUid||captureAreaUid.value||null}
   const row=prepareLogCapture(scope,input,text,files)
   await saveLogCapture(row)
   if(!logsActive||scope!==aiDataScope()||owner!==ownerId())throw Error('账号或空间已切换，日志恢复记录已保留')
   recovery.value=row;capture=bindRecovery(row,files,owner);capturePending.value=true
  }
  const pending=capture,row=recovery.value!,note=await pending.operation.run()
  pending.assertCurrent()
  await clearLogCapture(row.scope,row.operationUid)
  pending.assertCurrent()
  append(note)
  if(content.value===pending.text)content.value=''
  pendingFiles.value=pendingFiles.value.filter(file=>!pending.files.includes(file))
  capture=undefined;recovery.value=undefined;capturePending.value=false
  if(!content.value.trim()&&!pendingFiles.value.length)composerOpen.value=false
 }catch(source){
  if(logsActive)error.value=capture?.operation.created?'正文已保存，附件尚未全部加入；点击“重试附件”继续，不会再次创建日志。':source instanceof Error?source.message:'记录失败'
 }finally{if(logsActive)busy.value=false}
}

function edit(note: NoteEntity) { editing.value = note; editContent.value = note.content;editDay.value=quickLogDay(note,timezone); menuUid.value = '' }
async function saveEdit() {
 if(!editing.value||!editContent.value.trim()||editBusy.value)return
 if(!/^\d{4}-\d{2}-\d{2}$/.test(editDay.value)||localDateKey(new Date(`${editDay.value}T12:00:00`))!==editDay.value){error.value='请选择有效的记录日期';return}
 const note=editing.value,text=editContent.value,day=editDay.value,scope=aiDataScope(),revision=accountLifecycleRevision()
 editBusy.value=true;error.value=''
 try{const saved=await notes.updateEntity(note,{...(text!==note.content?{title:headline(text),content:text.trim()}:{}),periodKey:quickLogPeriodKey(day,note.uid)});if(!logsActive||aiDataScope()!==scope||accountLifecycleRevision()!==revision)return;append(saved);if(editing.value===note&&editContent.value===text&&editDay.value===day)editing.value=undefined}
 catch(source){if(logsActive&&aiDataScope()===scope&&accountLifecycleRevision()===revision)error.value=source instanceof Error?source.message:'日志保存失败，请重试'}
 finally{editBusy.value=false}
}
async function remove(note: NoteEntity) { if(!await confirmDialog({title:'删除日志',message:'将这条日志移入回收站？之后可以恢复。',confirmText:'移入回收站',cancelText:'取消',tone:'warning'}))return;await notes.service().remove(note);notes.notes=notes.notes.filter(item=>item.uid!==note.uid);menuUid.value='' }
function openLogMenu(event:MouseEvent,note:NoteEntity){
 const scope=aiDataScope(),revision=accountLifecycleRevision()
 const run=(action:()=>unknown|Promise<unknown>)=>async()=>{if(!logsActive||aiDataScope()!==scope||accountLifecycleRevision()!==revision)return;try{await action()}catch(source){error.value=source instanceof Error?source.message:'操作失败，请重试'}}
 openContextMenu(event,[
  {id:'edit',label:'编辑',run:run(()=>edit(note))},
  {id:'pin',label:note.pinned?'取消置顶':'置顶',run:run(()=>notes.togglePinned(note))},
  {id:'project',label:'修改归属',separator:true,run:run(()=>openProjectPicker(note))},
  {id:'note',label:'转为笔记',run:run(()=>deriveNote(note))},
  {id:'task',label:'创建任务',run:run(()=>deriveTask(note))},
  {id:'copy',label:'复制正文',separator:true,run:run(()=>navigator.clipboard.writeText(note.content))},
  {id:'delete',label:'删除',danger:true,separator:true,run:run(()=>remove(note))},
 ])
 const rect=(event.currentTarget as HTMLElement).getBoundingClientRect();contextMenuState.x=rect.right-180;contextMenuState.y=rect.bottom+6
}
function openProjectPicker(note:NoteEntity) { if(projectBusy.value)return;projectTarget.value=note;selectedProjectUid.value=note.projectUid||'';selectedAreaUid.value=note.areaUid||'';projectError.value='';menuUid.value='' }
async function saveProjectAssociation() {
 if(!projectTarget.value||projectBusy.value||!projectChanged.value)return
 const target=projectTarget.value,uid=selectedProjectUid.value,scope=aiDataScope(),revision=accountLifecycleRevision()
 const current=notes.notes.find(item=>item.uid===target.uid&&!item.deleted),project=projects.value.find(item=>item.uid===uid&&(item.uid===current?.projectUid||associationProjects.value.some(option=>option.uid===item.uid)))
 if(!current){projectError.value='日志已变化，请关闭后刷新重试';return}
 if(current.version!==target.version){projectError.value='日志已变化，请关闭后刷新重试';return}
 if(uid&&!project){projectError.value='该项目当前不可关联，请重新选择';return}
 if(selectedAreaUid.value!==(current.areaUid||'')&&selectedAreaUid.value&&!availableAreas.value.some(area=>area.uid===selectedAreaUid.value)){projectError.value='目标领域不可用，请重新选择';return}
 projectBusy.value=true;projectError.value=''
 try{
  const saved=await notes.updateEntity(current,{projectUid:project?.uid||null,areaUid:project?.areaUid||selectedAreaUid.value||null,...((current.areaUid||'')!==selectedAreaUid.value||(current.projectUid||'')!==uid?{folderUid:null}:{})})
  if(!logsActive||aiDataScope()!==scope||accountLifecycleRevision()!==revision)return
  append(saved);projectTarget.value=undefined
 }catch(source){if(logsActive&&aiDataScope()===scope&&accountLifecycleRevision()===revision)projectError.value=source instanceof Error?source.message:'修改归属失败，请重试'}
 finally{projectBusy.value=false}
}
async function deriveNote(source: NoteEntity) { const note = await notes.service().create({ title: headline(source.content), content: source.content, type: 'note', status: 'active', captureSource: 'log_conversion', projectUid: source.projectUid, areaUid: source.areaUid }); append(note); try { await noteLinksService.create(note.uid, source.uid, 'source') } catch {} await router.push({ path: '/notes', query: { note: note.uid } }) }
async function deriveTask(source: NoteEntity) { const task = await tasksService.create({ uid: crypto.randomUUID(), title: headline(source.content), description: source.content, projectUid: source.projectUid, areaUid: source.areaUid, priority: 0, completed: false, version: 0 }); await taskNotesService.link(task.uid, source.uid, 'derived_from'); await router.push({ path: '/tasks', query: { task: task.uid } }) }
async function applyIntent() { if (route.query.create === 'diary') kind.value = 'diary'; if (route.query.focus === 'progress') kind.value = 'work'; if(typeof route.query.projectUid==='string')projectUid.value=route.query.projectUid; await nextTick();composer.value?.focus(); if (route.query.date) await jumpToDate() }

function deactivate() {
  logsActive=false
  unregisterDraft()
  window.removeEventListener('beforeunload',protectPageExit)
  closeFloating()
  closeContextMenu()
  window.removeEventListener('pointerdown', closeFloating)
  window.removeEventListener('keydown', keydown)
}
function protectPageExit(event:BeforeUnloadEvent){if(busy.value||editBusy.value||projectBusy.value||hasDraft()){event.preventDefault();event.returnValue=''}}
onMounted(async () => {
  window.addEventListener('beforeunload',protectPageExit)
  window.addEventListener('pointerdown', closeFloating)
  window.addEventListener('keydown', keydown)
  await restoreCapture()
  const scope=aiDataScope(),revision=accountLifecycleRevision()
  try{const values=await workspaceService.areas();if(logsActive&&scope===aiDataScope()&&revision===accountLifecycleRevision())areas.value=values}catch{if(logsActive)error.value='领域加载失败，请刷新后重试'}
  const background = Boolean(logsViewCache.loadedAt)
  if (!logsViewCache.loadedAt || Date.now() - logsViewCache.loadedAt > 300_000) await load(background)
  await applyIntent()
})
watch(globalAreaUid,value=>{if(!capturePending.value)changeArea(value,true);projectTarget.value=undefined;detail.value=undefined})
onBeforeUnmount(deactivate)
watch(() => route.fullPath, async () => { jumpDate.value = validAnchor(route.query.date as string); closeFloating(); await applyIntent() })
</script>

<template>
  <main ref="scrollContainer" class="logs-page">
    <h1 class="workspace-page-heading">日志</h1>
    <section class="composer"><MarkdownEditor ref="composer" v-model="content" :owner-id="ownerId()" :readonly="busy||composerOpen" live-preview @attachment-files="addPendingFiles" @submit="save"/>
      <div v-if="recovery||recoveryReadFailed" class="capture-recovery"><span>{{recoveryReadFailed?'日志恢复记录读取失败':'有未完成的日志记录'}}</span><ElButton size="small" @click="openComposer">打开处理</ElButton></div>
      <footer><div class="composer-classification"><label class="kind-select"><select v-model="kind" aria-label="记录类型"><option value="work">▤　工作日志</option><option value="diary">▤　日记</option></select></label><i>·</i><label><select v-model="captureAreaUid" aria-label="日志所属领域" :disabled="busy||capturePending" @change="changeArea(captureAreaUid,true)"><option value="">未分类</option><option v-for="area in availableAreas" :key="area.uid" :value="area.uid">{{area.name}}</option></select></label><label class="project-select"><select v-model="projectUid" aria-label="关联项目" :disabled="busy||capturePending" @change="changeProject(projectUid,true)"><option value="">＋　关联项目</option><option v-for="project in activeProjects" :key="project.uid" :value="project.uid">{{project.name}}</option></select></label><ElButton text class="composer-tool" @click="addTag">＃ 添加标签</ElButton><ElButton text class="composer-tool" @click="fileInput?.click()">⌕ 添加附件</ElButton><small v-if="pendingFiles.length">已选择 {{pendingFiles.length}} 个附件</small><input ref="fileInput" hidden multiple type="file" @change="chooseFiles" /></div><div class="submit-actions"><ElButton native-type="button" class="composer-expand" @click="openComposer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>展开编辑</ElButton><ElButton type="primary" class="primary" :disabled="busy||!recoveryReady||recoveryReadFailed||(!capturePending&&!content.trim())" @click="save">{{capturePending&&capture?.operation.created?'重试附件':'记录'}}</ElButton><small>Ctrl + Enter</small></div></footer>    </section>
    <LogMarkdownDialog ref="expandedComposer" v-model:open="composerOpen" v-model="content" :title="kind==='diary'?'写日记':'写日志'" :owner-id="ownerId()" :busy="busy" :error="error" preserve-on-close :save-label="capturePending?'继续记录':'记录'" @save="save" @attachment-files="addPendingFiles"><p>{{kind==='diary'?'日记':'工作日志'}} · {{areaName(captureAreaUid)}} · {{projectName(projectUid)||'未关联项目'}}</p><div v-if="recoveryReadFailed" role="alert">未能读取本机恢复记录。<ElButton size="small" :disabled="busy" @click="restoreCapture">重新读取</ElButton><ElButton size="small" type="danger" plain :disabled="busy" v-if="invalidRecovery" @click="discardInvalidRecovery">放弃损坏记录</ElButton></div><div v-if="recovery">有未完成的记录。<ElButton size="small" type="danger" plain :disabled="busy" @click="discardRecovery">放弃恢复</ElButton></div></LogMarkdownDialog>
    <div class="stream-toolbar">
      <nav><ElButton text :class="{active:filter==='all'}" @click="setFilter('all')">全部</ElButton><ElButton text :class="{active:filter==='work'}" @click="setFilter('work')">工作日志</ElButton><ElButton text :class="{active:filter==='diary'}" @click="setFilter('diary')">日记</ElButton></nav>
      <div class="stream-actions"><label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input v-model="query" placeholder="搜索全部日志…" /></label><div ref="calendarPanel" class="calendar-wrap"><ElButton class="calendar-trigger" :aria-expanded="calendarOpen" aria-label="选择日志日期" @click="calendarOpen=!calendarOpen"><svg viewBox="0 0 24 24"><path d="M5 3v3M19 3v3M3 9h18M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2Z"/></svg><strong>日期 · {{monthLabel}}</strong><span>⌄</span></ElButton><section v-if="calendarOpen" class="log-calendar"><header><button aria-label="上个月" @click="browseCalendarMonth(-1)">‹</button><strong>{{monthLabel}}</strong><button aria-label="下个月" @click="browseCalendarMonth(1)">›</button></header><div class="calendar-weekdays"><span v-for="label in ['日','一','二','三','四','五','六']" :key="label">{{label}}</span></div><div class="calendar-grid"><button v-for="item in calendarDays" :key="item.day" :class="{muted:!item.currentMonth,today:item.today,selected:item.day===jumpDate,'has-log':item.hasLog}" :title="item.hasLog?`${item.day} 有日志`:item.day" @click="selectCalendarDay(item.day)"><b>{{item.number}}</b><i v-if="item.hasLog"/></button></div><footer><span><i/> 有日志</span><button @click="backToday();calendarOpen=false">回到今天</button></footer></section></div><ElButton class="today-button" @click="backToday">回到本月</ElButton></div>
    </div>
    <p v-if="dateJumped&&!calendarOpen" class="date-jump-status" role="status">{{dayLabel(jumpDate)}} · {{countForDay(jumpDate)?`${countForDay(jumpDate)} 条日志`:'当前筛选下没有日志'}} <ElButton @click="router.push({path:'/reviews',query:reviewRouteQuery({period:'daily',anchor:jumpDate,scope:globalAreaUid?{kind:'area',areaUid:globalAreaUid}:{kind:'personal'}})})">查看当天回顾</ElButton></p>
    <p v-if="error" class="error">{{error}}</p><p v-if="loading">正在准备时间流…</p>
    <section v-else class="stream">
      <div v-if="!timeline.length" class="empty">还没有记录<br><small>想到什么就写下来，不必先整理。</small></div>
      <template v-for="(item,index) in timeline" :key="item.type+item.uid">
        <header v-if="index===0||timeline[index-1].day!==item.day" :id="`log-day-${item.day}`"><strong>{{dayLabel(item.day)}}</strong><span>{{countForDay(item.day)}} 条记录</span></header>
        <article class="log-card" tabindex="0" @click="detail=item" @keydown.enter="detail=item"><time>{{timelineTimeLabel(item)}}</time><span class="timeline-kind" :class="timelineKind(item)">{{timelineKindLabel(item)}}</span>
          <div v-if="item.type==='quick'"><p class="log-summary">{{contentSummary(cleanContent(item.note.content)||item.note.content)}}</p><div class="badges"><span v-if="projectName(item.note.projectUid)" class="project"><svg viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3z"/></svg>{{projectName(item.note.projectUid)}}</span><span v-for="tag in tagsOf(item.note.content)" :key="tag"># {{tag}}</span><span v-if="item.note.pinned">已置顶</span></div></div>
          <div v-else-if="item.type==='journal'" class="journal-entry"><p class="log-summary">{{contentSummary(cleanJournalMarkdown(item.note.content))||item.note.title||'暂无正文'}}</p><div class="badges"><span v-if="!journalMeaningfulText(item.note.content)">空日志</span></div></div><div v-else><p class="log-summary">{{contentSummary(item.log.content)}}</p><div class="badges"><span v-if="projectName(item.log.projectUid)" class="project">▱ {{projectName(item.log.projectUid)}}</span></div></div>
          <aside v-if="item.type==='quick'" @pointerdown.stop @click.stop><ElButton @click="openLogMenu($event,item.note)" text class="pc-more-trigger" aria-label="更多操作" aria-haspopup="menu" title="更多操作"><MoreIcon/></ElButton></aside>
        </article>
      </template>
    </section>
    <ElDialog :model-value="Boolean(detail)" title="日志详情" width="min(820px,96vw)" class="log-detail-dialog" @close="detail=undefined"><template #header><div class="log-detail-heading"><span>{{detailKind}}</span><h2>{{detailTitle}}</h2><p v-if="detail">{{dayLabel(detail.day)}}<template v-if="detailProject"> · {{detailProject}}</template></p></div></template><MarkdownPreview :content="detailContent" :owner-id="ownerId()"/><template #footer><ElButton @click="navigator.clipboard.writeText(detailContent)">复制正文</ElButton><ElButton type="primary" @click="detail=undefined">关闭</ElButton></template></ElDialog>
    <LogMarkdownDialog :open="!!editing" v-model="editContent" title="编辑记录" :metadata-dirty="Boolean(editing&&editDay!==quickLogDay(editing,timezone))" :owner-id="ownerId()" :busy="editBusy" :error="error" @update:open="value=>{if(!value)editing=undefined}" @save="saveEdit"><label class="log-edit-date">记录日期<PcDatePicker v-model="editDay" aria-label="日志记录日期" helper="today" :teleported="false"/></label><small>修改日志归属日期，创建时间和正文会保留。</small></LogMarkdownDialog>
    <ElDialog :model-value="Boolean(projectTarget)" title="修改归属" width="min(460px,94vw)" :close-on-click-modal="!projectBusy" :close-on-press-escape="!projectBusy" :show-close="!projectBusy" @close="projectTarget=undefined">
      <div class="log-project-picker">
        <p class="log-project-context">{{projectTarget?.title||'未命名记录'}}</p>
        <label for="log-area-select">所属领域</label><ElSelect id="log-area-select" v-model="selectedAreaUid" :disabled="projectBusy" aria-label="目标领域" @change="value=>changeArea(value)"><ElOption label="未分类" value=""/><ElOption v-for="area in availableAreas" :key="area.uid" :label="area.name" :value="area.uid"/></ElSelect><label for="log-project-select">选择项目</label>
        <ElSelect id="log-project-select" v-model="selectedProjectUid" @change="value=>changeProject(value)" filterable clearable :disabled="projectBusy" placeholder="搜索或选择项目" no-match-text="没有匹配的项目" no-data-text="暂无可关联的项目" aria-label="选择关联项目">
          <ElOption v-for="project in associationProjects" :key="project.uid" :label="project.name" :value="project.uid"/>
          <ElOption v-if="currentLinkedProject&&!associationProjects.some(item=>item.uid===currentLinkedProject?.uid)" :label="`${currentLinkedProject.name}（当前关联）`" :value="currentLinkedProject.uid" disabled/>
          <ElOption v-if="projectTarget?.projectUid&&!currentLinkedProject" label="原关联项目不可用" :value="projectTarget.projectUid" disabled/>
        </ElSelect>
        <p class="log-project-help">可选择未分类；选择项目后领域随项目更新。更换领域会解除不匹配的项目，归属变化时移出原目录；正文、日期和附件保留。</p>
        <p v-if="projectError" class="error" role="alert">{{projectError}}</p>
      </div>
      <template #footer><ElButton :disabled="projectBusy" @click="projectTarget=undefined">取消</ElButton><ElButton type="primary" :loading="projectBusy" :disabled="!projectChanged" @click="saveProjectAssociation">保存</ElButton></template>
    </ElDialog>
    <ElButton class="back-top" title="回到顶部" @click="scrollTop">↑</ElButton>
  </main>
</template>

<style scoped>
.log-project-picker{display:grid;gap:10px}.log-project-context{margin:0 0 8px;color:var(--pc-muted);overflow-wrap:anywhere}.log-project-picker label{font-weight:600}.log-project-picker :deep(.el-select){width:100%}.log-project-help{margin:0;color:var(--pc-muted);font-size:12px;line-height:1.6}

.workspace-page-heading{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.logs-page{box-sizing:border-box;width:min(var(--pc-standard-width),100%);min-height:calc(100vh - 64px);margin-inline:auto;padding:20px 34px 60px;background:#f6f8f6}.composer,.stream article{border:1px solid var(--pc-border);border-radius:10px;background:#fff}.composer textarea{box-sizing:border-box;width:100%;min-height:112px;padding:17px;border:0;outline:0;resize:vertical;font-size:13px;line-height:1.7}.composer-tools{display:flex;align-items:center;gap:8px;padding:0 13px 8px}.composer-tools button,.composer footer select,.expand{padding:7px 10px;border:1px solid var(--pc-border);border-radius:7px;background:#fff}.composer-tools small{color:var(--pc-muted)}.composer footer,.stream-toolbar,.stream>header,.editor header,.editor footer{display:flex;align-items:center;justify-content:space-between}.composer footer{padding:9px 13px;border-top:1px solid #edf1ee}.composer footer>div,.submit-actions,.stream-actions,.date-jump{display:flex;align-items:center;gap:8px}.submit-actions small{color:var(--pc-muted);font-size:9px}.primary{padding:9px 22px;border:0;border-radius:7px;background:var(--pc-primary);color:#fff}.stream-toolbar{margin:16px 0}.stream-toolbar nav{display:flex;border-radius:8px;background:#eaf0ec}.stream-toolbar nav button{min-width:88px;padding:9px 16px;border:0;background:transparent}.stream-toolbar nav button.active{border-radius:8px;background:var(--pc-primary);color:#fff}.search{display:flex;align-items:center;width:195px;padding:0 10px;border:1px solid var(--pc-border);border-radius:8px;background:#fff}.search input{width:100%;padding:9px 5px;border:0;outline:0}.filter-wrap{position:relative}.filter-wrap>button,.date-jump button,.date-jump label{padding:9px 12px;border:1px solid var(--pc-border);border-radius:8px;background:#fff}.filter-popover,.entry-menu{position:absolute;z-index:20;display:grid;min-width:150px;padding:5px;border:1px solid var(--pc-border);border-radius:9px;background:#fff;box-shadow:0 12px 30px #1233}.filter-popover{top:42px;right:0}.filter-popover button,.entry-menu button,.entry-menu label{padding:8px;border:0;background:#fff;text-align:left}.filter-popover button.active{background:var(--pc-primary-soft);color:var(--pc-primary)}.date-jump label{display:flex}.date-jump input{width:18px;padding:0;border:0;color:transparent}.stream{border:0;background:transparent}.stream>header{scroll-margin-top:76px;padding:14px 0 9px;background:transparent}.stream>header strong{font-size:15px}.stream>header strong small,.stream>header span,.stream time{color:var(--pc-muted);font-size:10px}.stream article{margin-bottom:-1px;border-radius:0;grid-template-columns:82px minmax(0,1fr) 34px;padding:12px 18px 12px 46px}.stream article:before{content:'';position:absolute;left:16px;top:0;bottom:0;border-left:1px solid #bad2c5}.stream article:after{content:'';position:absolute;left:12px;top:19px;width:8px;height:8px;border-radius:50%;background:var(--pc-primary)}.stream article:first-of-type{border-radius:10px 10px 0 0}.stream p{margin:0 0 8px;white-space:pre-wrap;line-height:1.55}.badges{display:flex;flex-wrap:wrap;gap:7px}.badges span{padding:4px 8px;border-radius:6px;background:#f3f5f4;color:#67756e;font-size:9px}.badges .project{color:#4d6f92}.badges .work{background:#e8f5ee;color:#1a7a51}.badges .diary{background:#faeaf2;color:#b23c75}.stream aside>button{border:0;background:transparent}.entry-menu{right:15px}.entry-menu label{display:grid}.danger,.error{color:#a33!important}.empty{padding:40px;text-align:center}.overlay{position:fixed;z-index:1100;inset:0;display:grid;place-items:center;background:#14271d66}.editor{width:min(680px,calc(100vw - 40px));padding:18px;border-radius:13px;background:#fff}.editor textarea{box-sizing:border-box;width:100%;min-height:260px;margin:14px 0;padding:12px}.editor header button{border:0;background:none;font-size:20px}.editor footer{justify-content:flex-end;gap:8px}@media(max-width:800px){.logs-page{padding:16px}.composer footer,.stream-toolbar{align-items:stretch;flex-direction:column}.composer footer>div,.stream-actions,.date-jump{flex-wrap:wrap}.search{width:auto}.stream article{grid-template-columns:48px minmax(0,1fr) 28px;padding-left:34px}}
.composer-formatbar{display:flex;align-items:center;gap:3px;padding:7px 10px;border-bottom:1px solid #edf1ee;background:#fafcfb}.composer-formatbar button{min-width:30px;height:27px;padding:0 7px;border:0;border-radius:5px;background:transparent;color:#526159;font-size:10px}.composer-formatbar button:hover{background:#edf4f0;color:var(--pc-primary)}.composer-formatbar>span{margin-left:auto;color:var(--pc-muted);font-size:9px}.composer :deep(.markdown-editor){min-height:150px;margin:0;padding:15px 17px}.composer :deep(.cm-content){font-size:13px}.composer :deep(.cm-scroller){min-height:inherit}.editor :deep(.markdown-editor){min-height:300px;margin:14px 0;padding:14px;border:1px solid var(--pc-border);border-radius:8px}.editor :deep(.cm-scroller){min-height:270px}.month-locator{display:flex;align-items:center;gap:7px;height:38px}.month-locator>span{padding:3px 6px;border-radius:5px;background:#f3f5f4;color:var(--pc-muted);font-size:8px;white-space:nowrap}
.composer{box-shadow:0 1px 2px #17342608}.composer textarea::placeholder{color:#87938d}.composer-tools button{display:flex;align-items:center;gap:6px;color:#56645d}.composer footer{min-height:40px}.composer footer select:first-child{min-width:120px}.composer footer select:nth-child(2){min-width:112px}.stream-toolbar{gap:18px}.stream-actions{margin-left:auto}.stream>header:not(:first-child){margin-top:18px}.stream article{min-height:65px;align-items:start}.stream article>time{padding-top:1px;color:#33463d;font-variant-numeric:tabular-nums}.stream article>div>p{font-size:12px;color:#1f3129}.stream article+article{border-top-color:#eef2ef}.stream aside>button{font-size:16px;line-height:1}.back-top{position:fixed;right:22px;bottom:22px;z-index:15;width:42px;height:42px;border:1px solid var(--pc-border);border-radius:50%;background:#fff;color:var(--pc-primary);font-size:20px;box-shadow:0 5px 18px #1734261c}.primary:hover{filter:brightness(.96)}button{cursor:pointer}.primary:disabled{cursor:not-allowed;opacity:.55}.composer-tools svg,.submit-actions svg,.stream-actions svg,.badges svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.expand{display:grid;place-items:center;width:38px;height:38px;padding:0}.search>svg{flex:0 0 auto}.filter-wrap>button{display:flex;align-items:center;gap:6px}.date-jump label>svg{width:18px;height:18px}.badges span{display:inline-flex;align-items:center;gap:5px}@media(min-width:801px){.composer textarea{height:108px}.composer{min-height:190px}.stream-toolbar{position:relative}.stream article{padding-right:22px}}
.log-summary{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;max-width:72ch;color:#28342e}.log-card{cursor:pointer}.log-card:hover{position:relative;z-index:1;border-color:#9ebaaa;background:#fbfdfc}.log-card:focus-visible{outline:2px solid var(--pc-primary);outline-offset:2px}.detail-overlay{position:fixed;z-index:1200;inset:0;display:grid;place-items:center;padding:24px;background:#14271d66}.log-detail{display:grid;grid-template-rows:auto minmax(0,1fr) auto;width:min(820px,calc(100vw - 48px));max-height:min(820px,calc(100vh - 48px));overflow:hidden;border:1px solid var(--pc-border);border-radius:14px;background:#fff;box-shadow:0 24px 70px #10271a33}.log-detail>header,.log-detail>footer{display:flex;align-items:center;justify-content:space-between;padding:18px 22px}.log-detail>header{border-bottom:1px solid var(--pc-border)}.log-detail>header span{color:var(--pc-primary);font-size:10px;font-weight:700}.log-detail h2{margin:4px 0;font-size:21px}.log-detail header p{margin:0;color:var(--pc-muted);font-size:10px}.log-detail header button{border:0;background:transparent;font-size:24px}.log-detail>section{min-height:180px;overflow:auto;padding:24px 28px;line-height:1.7}.log-detail>footer{justify-content:flex-end;gap:9px;border-top:1px solid var(--pc-border)}.log-detail>footer button{padding:8px 16px;border:1px solid var(--pc-border);border-radius:7px;background:#fff}.log-detail>footer .primary{border-color:var(--pc-primary);background:var(--pc-primary)}@media(max-width:800px){.detail-overlay{padding:10px}.log-detail{width:calc(100vw - 20px);max-height:calc(100vh - 20px)}.log-detail>section{padding:18px}}
.composer-classification label{display:flex;align-items:center;gap:6px}.composer-classification label>span,.date-jump>span{color:var(--pc-muted);font-size:9px;white-space:nowrap}.composer-classification label:first-child select{min-width:120px}.composer-classification label:last-child select{min-width:140px}.date-jump>span{font-weight:600}.date-jump>button{padding:8px 10px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;color:var(--pc-primary)}
/* Prototype-aligned log workspace */
.logs-page{padding-top:18px;background:#fff}.composer{min-height:0;box-shadow:none}.composer textarea{height:auto;min-height:92px;padding:14px 17px;font-size:14px}.composer footer{min-height:46px;padding:8px 12px}.composer-classification{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}.composer-classification>i{color:#9aa59f;font-style:normal}.composer-classification select,.composer-tool{height:34px;padding:0 10px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:#53625a;font-size:12px}.composer-classification .kind-select select{min-width:124px}.composer-classification .project-select select{min-width:116px;border-color:transparent;background:var(--pc-primary-soft);color:var(--pc-primary);font-weight:600}.composer-tool{border-color:transparent}.composer-tool:hover{background:#f4f7f5}.composer-classification small{color:var(--pc-muted);font-size:10px}.stream-toolbar{align-items:center;margin:18px 0 14px}.stream-toolbar nav{flex:none;padding:2px;background:#f4f6f5}.stream-toolbar nav button{min-width:98px;padding:9px 17px;color:#58675f}.stream-toolbar nav button.active{background:#e3f2ea;color:var(--pc-primary);font-weight:650}.stream-actions{min-width:0;gap:8px}.search{box-sizing:border-box;flex:0 1 230px;min-width:160px;width:clamp(170px,20vw,230px);height:38px;overflow:hidden}.search:focus-within{border-color:#8eb9a2;box-shadow:0 0 0 2px #dcece3}.search input{min-width:0;flex:1}.month-jump{display:grid!important;grid-template-columns:34px minmax(105px,126px) 34px;gap:0!important;height:38px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;overflow:hidden}.month-jump button{padding:0;border:0;background:#fff;color:#33443b;font-size:20px}.month-jump button:hover{background:#f5f7f6}.month-jump strong{display:grid;place-items:center;font-size:12px;font-weight:650;white-space:nowrap}.today-button{height:38px;padding:0 14px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;color:#425148;white-space:nowrap}.stream>header{padding:16px 0 8px;border-bottom:1px solid #e5ebe7}.stream>header strong{font-size:16px}.stream>header span{font-size:11px}.stream article{position:relative;display:grid;grid-template-columns:98px 90px minmax(0,1fr) 28px;gap:0;padding:14px 10px 14px 46px;border-width:0 0 1px;border-radius:0;background:#fff}.stream article:first-of-type{border-radius:0}.stream article:before{left:20px;border-color:#dbe7e0}.stream article:after{left:16px;top:22px;background:#53b983}.stream article>time{padding-top:2px;color:#627169;font-size:12px;white-space:nowrap}.timeline-kind{justify-self:start;padding:5px 10px;border-radius:7px;font-size:11px;font-weight:650;line-height:1.2}.timeline-kind.work{background:#e4f4eb;color:#158052}.timeline-kind.diary{background:#e7f1ff;color:#2871c8}.timeline-kind.project{background:#f0ebff;color:#7256b5}.log-summary{margin-bottom:8px!important;font-size:13px!important;line-height:1.55!important}.stream aside{justify-self:end}.stream aside>button{color:#425148;font-weight:700}.log-card:hover{background:#fbfdfc}.badges span{font-size:10px}.back-top{display:none}
@media(max-width:900px){.stream-toolbar{align-items:stretch;flex-direction:column}.stream-actions{margin-left:0;flex-wrap:wrap}.search{flex:1;min-width:190px}.stream article{grid-template-columns:90px 82px minmax(0,1fr) 24px;padding-left:36px}.stream article:before{left:14px}.stream article:after{left:10px}}
@media(max-width:620px){.logs-page{padding:16px}.composer footer{align-items:stretch;flex-direction:column}.submit-actions{justify-content:flex-end}.stream-toolbar nav{display:grid;grid-template-columns:repeat(3,1fr)}.stream-toolbar nav button{min-width:0}.stream-actions{display:grid;grid-template-columns:1fr auto}.search{grid-column:1/-1}.stream article{grid-template-columns:82px minmax(0,1fr) 24px;row-gap:8px}.timeline-kind{grid-column:2}.stream article>div{grid-column:2}.stream article>aside{grid-column:3;grid-row:1}.month-jump{grid-template-columns:32px minmax(92px,120px) 32px}}
.calendar-wrap{position:relative;flex:none}.calendar-trigger{display:flex;align-items:center;gap:8px;height:38px;min-width:164px;padding:0 10px;border:1px solid var(--pc-border);border-radius:8px;background:#fff;color:#425148}.calendar-trigger:hover,.calendar-trigger[aria-expanded="true"]{border-color:#9fc3af;background:#f8fbf9}.calendar-trigger svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.calendar-trigger strong{flex:1;font-size:11px}.calendar-trigger span{color:var(--pc-muted);font-size:10px}.log-calendar{position:absolute;z-index:80;top:44px;right:0;width:286px;padding:12px;border:1px solid var(--pc-border);border-radius:12px;background:#fff;box-shadow:0 18px 50px #17342626}.log-calendar>header{display:grid;grid-template-columns:30px 1fr 30px;align-items:center;margin-bottom:8px}.log-calendar>header strong{text-align:center;font-size:12px}.log-calendar>header button{width:30px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;font-size:19px}.log-calendar>header button:hover{background:#f1f5f2}.calendar-weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,1fr)}.calendar-weekdays span{padding:5px 0;color:var(--pc-muted);font-size:8px;text-align:center}.calendar-grid{gap:2px}.calendar-grid button{position:relative;display:grid;height:33px;padding:4px 0 7px;place-items:center;border:0;border-radius:7px;background:transparent;color:#34443b;font-size:10px}.calendar-grid button:hover{background:#edf5f0}.calendar-grid button.muted{color:#b0b8b3}.calendar-grid button.today b{color:var(--pc-primary);font-weight:800}.calendar-grid button.selected{background:var(--pc-primary-soft);box-shadow:inset 0 0 0 1px #b9d6c6}.calendar-grid button>i{position:absolute;bottom:4px;width:4px;height:4px;border-radius:50%;background:var(--pc-primary)}.calendar-grid button.muted>i{opacity:.45}.log-calendar>footer{display:flex;align-items:center;justify-content:space-between;margin-top:9px;padding-top:9px;border-top:1px solid #edf1ee}.log-calendar>footer span{display:flex;align-items:center;gap:5px;color:var(--pc-muted);font-size:8px}.log-calendar>footer span i{width:5px;height:5px;border-radius:50%;background:var(--pc-primary)}.log-calendar>footer button{padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--pc-primary);font-size:9px}.log-calendar>footer button:hover{background:var(--pc-primary-soft)}
@media(max-width:620px){.calendar-trigger{min-width:0}.log-calendar{position:fixed;top:50%;right:auto;left:50%;width:min(320px,calc(100vw - 24px));transform:translate(-50%,-50%);box-shadow:0 22px 70px #10271a4d}}
</style>


<style scoped>.date-jump-status{font-size:12px;color:var(--pc-muted);display:flex;align-items:center;gap:12px;flex-wrap:wrap}.date-jump-status button{padding:4px 8px;border:1px solid var(--pc-border);border-radius:6px;background:#fff;color:var(--pc-primary);font:inherit;cursor:pointer}</style>

<style scoped>
.composer-expand{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 12px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;color:#53625a;font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}.composer-expand:hover{border-color:#9fc3af;background:#f4f7f5;color:var(--pc-primary)}.composer-expand:focus-visible{outline:2px solid var(--pc-primary);outline-offset:2px}.composer-expand svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.capture-recovery{display:flex;align-items:center;flex-wrap:wrap;gap:10px;font-size:12px;line-height:1.6;padding:10px 14px;background:var(--pc-primary-soft,#edf5f0);border-radius:6px}.capture-recovery span{flex:1;min-width:180px}.capture-recovery button{font-size:12px;white-space:nowrap}
</style>

<style scoped>.log-edit-date{display:flex;align-items:center;gap:12px;font-size:13px}.log-edit-date+small{display:block;margin-top:8px;color:var(--pc-muted)}</style>

<style scoped>
.logs-page :deep(.el-button+.el-button){margin-left:0}.submit-actions :deep(.el-button){height:34px;min-width:76px}.composer-classification :deep(.el-button){height:34px}.stream-toolbar nav :deep(.el-button){height:36px;margin:0}.calendar-trigger :deep(>span){display:flex;align-items:center;gap:8px;width:100%}.capture-recovery :deep(.el-button){flex:none}
.log-detail-heading>span{color:var(--pc-primary);font-size:12px}.log-detail-heading h2{margin:6px 0;font-size:20px;line-height:1.5;color:var(--pc-text)}.log-detail-heading p{margin:0;color:var(--pc-muted);font-size:12px}
</style>
<style>.log-detail-dialog{border-radius:12px}.log-detail-dialog .el-dialog__body{max-height:65vh;overflow:auto;padding:16px 8px}.log-detail-dialog .el-dialog__footer .el-button{min-width:76px}</style>
