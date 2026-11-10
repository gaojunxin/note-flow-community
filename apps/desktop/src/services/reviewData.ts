import { quickLogPeriodDay, isPeriodicNote, journalPeriod, type JournalPeriodType, type ProjectLogEntity } from '@note-flow/core'
import type { NoteEntity } from '@note-flow/core'
import type { TaskEntity } from './tasks'
import type { FocusSession } from './localPersonal'

export type ReviewScope = { areaUid?: string | null; projectUid?: string | null; all?: boolean }
export type ReviewEvent = {
  uid: string
  kind: 'task_completed' | 'note_created' | 'log_record' | 'periodic_record' | 'project_log' | 'focus'
  occurredAt: string
  title: string
  areaUid?: string | null
  projectUid?: string | null
  source: TaskEntity | NoteEntity | ProjectLogEntity | FocusSession
}

export interface ReviewDataInput {
  tasks?: TaskEntity[]
  notes?: NoteEntity[]
  logs?: ProjectLogEntity[]
  focuses?: FocusSession[]
}

export interface ReviewDataLoaderDependencies {
  tasks(): Promise<TaskEntity[]>
  notes(): Promise<NoteEntity[]>
  projects(areaUid?: string): Promise<Array<{ uid: string; areaUid: string }>>
  logs(projectUid: string): Promise<ProjectLogEntity[]>
  focuses(from: string, to: string): Promise<FocusSession[]>
}

export interface LoadedReviewData extends ReviewDataInput {
  events: ReviewEvent[]
}

function inScope(value: { areaUid?: string | null; projectUid?: string | null }, scope: ReviewScope) {
  if (scope.projectUid) return value.projectUid === scope.projectUid
  if (scope.areaUid) return value.areaUid === scope.areaUid
  return scope.all === true || (!value.areaUid && !value.projectUid)
}

const dateFormatters=new Map<string,Intl.DateTimeFormat>()
const calendarDates=new Map<string,string>()
/** A quick log's user-selected calendar date survives synchronization and audit timestamp changes. */
export function quickLogDay(note:Pick<NoteEntity,'periodKey'|'createdAt'|'updatedAt'>,timezone:string){
 const day=quickLogPeriodDay(note.periodKey)
 return /^\d{4}-\d{2}-\d{2}$/.test(day)?day:calendarDate(note.createdAt||note.updatedAt||'',timezone)
}

export function calendarDate(value: string, timezone: string): string {
  const key=timezone+'|'+value,cached=calendarDates.get(key)
  if(cached!==undefined)return cached
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  let formatter=dateFormatters.get(timezone)
  if(!formatter){formatter=new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' });if(dateFormatters.size>=16)dateFormatters.clear();dateFormatters.set(timezone,formatter)}
  const parts = formatter.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value || ''
  const result=`${part('year')}-${part('month')}-${part('day')}`
  if(calendarDates.size>=10000)calendarDates.clear()
  calendarDates.set(key,result)
  return result
}

/** Builds a display timeline from each entity's business timestamp, never its generic sync timestamp. */
export function buildReviewEvents(input: ReviewDataInput, options: { periodType: JournalPeriodType; anchor: string; timezone: string; scope?: ReviewScope }): ReviewEvent[] {
  const range = journalPeriod(options.periodType, options.anchor), scope = options.scope || {}
  const tasksByUid = new Map((input.tasks || []).map(task => [task.uid, task]))
  const inside = (timestamp?: string | null) => { const day = timestamp ? calendarDate(timestamp, options.timezone) : ''; return day >= range.start && day <= range.end }
  const insideDay = (day?: string | null) => Boolean(day && day.slice(0, 10) >= range.start && day.slice(0, 10) <= range.end)
  const events: ReviewEvent[] = []
  for (const task of input.tasks || []) if (!task.deleted && task.completed && inside(task.completedAt) && inScope(task, scope)) events.push({ uid:`task:${task.uid}`, kind:'task_completed', occurredAt:task.completedAt!, title:task.title, areaUid:task.areaUid, projectUid:task.projectUid, source:task })
  for (const note of input.notes || []) if (!note.deleted && inScope(note, scope)) {
    if (isPeriodicNote(note)) {
      const occurredAt = note.periodStart ? `${note.periodStart.slice(0, 10)}T12:00:00` : undefined
      if (insideDay(note.periodStart)) events.push({ uid:`periodic-record:${note.uid}`, kind:'periodic_record', occurredAt:occurredAt!, title:note.title || '未命名回顾', areaUid:note.areaUid, projectUid:note.projectUid, source:note })
    } else if(note.type==='work_log'&&String(note.captureSource||'').startsWith('quick_log_')&&note.periodKey){
      const day=quickLogDay(note,options.timezone);if(insideDay(day))events.push({uid:`note-created:${note.uid}`,kind:'log_record',occurredAt:`${day}T12:00:00`,title:note.title||'未命名记录',areaUid:note.areaUid,projectUid:note.projectUid,source:note})
    } else if (inside(note.createdAt)) {
      events.push({ uid:`note-created:${note.uid}`, kind:note.type==='work_log'?'log_record':'note_created', occurredAt:note.createdAt!, title:note.title || '未命名记录', areaUid:note.areaUid, projectUid:note.projectUid, source:note })
    }
  }
  for (const log of input.logs || []) if (!log.deleted && inside(log.occurredAt) && inScope(log, scope)) events.push({ uid:`project-log:${log.uid}`, kind:'project_log', occurredAt:log.occurredAt, title:log.content, areaUid:log.areaUid, projectUid:log.projectUid, source:log })
  for (const focus of input.focuses || []) {
    const linkedTask = focus.taskUid ? tasksByUid.get(focus.taskUid) : undefined
    const matchesScope = linkedTask ? inScope(linkedTask, scope) : !scope.projectUid && !scope.areaUid
    if (focus.status === 'completed' && focus.sessionType === 'focus' && inside(focus.startedAt) && matchesScope) events.push({ uid:`focus:${focus.uid}`, kind:'focus', occurredAt:focus.startedAt, title:`专注 ${Math.round((focus.actualSeconds || 0) / 60)} 分钟`, areaUid:linkedTask?.areaUid, projectUid:linkedTask?.projectUid, source:focus })
  }
  return events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.uid.localeCompare(right.uid))
}

export function expandedUtcRange(periodType: JournalPeriodType, anchor: string) {
  const range = journalPeriod(periodType, anchor)
  const from = new Date(`${range.start}T00:00:00.000Z`), to = new Date(`${range.end}T00:00:00.000Z`)
  // IANA offsets span the previous/next UTC date. Fetch a safe envelope, then
  // calendarDate performs the exact timezone filter.
  from.setUTCDate(from.getUTCDate() - 1); to.setUTCDate(to.getUTCDate() + 2)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function createReviewDataLoader(dependencies: ReviewDataLoaderDependencies) {
  return async function load(options: { periodType: JournalPeriodType; anchor: string; timezone: string; scope?: ReviewScope }): Promise<LoadedReviewData> {
    const scope = options.scope || {}, window = expandedUtcRange(options.periodType, options.anchor)
    const [tasks, notes, focuses, projects] = await Promise.all([
      dependencies.tasks(), dependencies.notes(), dependencies.focuses(window.from, window.to),
      scope.projectUid ? Promise.resolve([{ uid:scope.projectUid, areaUid:scope.areaUid || '' }]) : dependencies.projects(scope.areaUid || undefined)
    ])
    const logs = (await Promise.all(projects.map(project => dependencies.logs(project.uid)))).flat()
    const input = { tasks, notes, logs, focuses }
    return { ...input, events:buildReviewEvents(input, options) }
  }
}
