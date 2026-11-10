import type {LunarRepeatRule} from './contracts/recurrence'
/** Keep legacy pre-generated cycles as data, but expose only the first open cycle. */
export type RecurringTask = {
  uid: string
  recurrenceRule?: string | null
  recurrenceSourceUid?: string | null
  recurrenceOccurrenceKey?: string | null
  startAt?: string | null
  dueAt?: string | null
  completed?: boolean
  abandonedAt?: string | null
  deleted?: boolean
  recurrencePreview?: boolean
}
export const recurrenceSeriesUid = (task: RecurringTask) => task.recurrenceSourceUid || task.uid
export const isOpenTask = (task: RecurringTask) => !task.deleted && !task.completed && !task.abandonedAt
const cycleKey = (task: RecurringTask) => task.recurrenceOccurrenceKey || task.startAt || task.dueAt || '9999'
export function currentRecurringTasks<T extends RecurringTask>(tasks: T[]): T[] {
  const first = new Map<string, T>()
  for (const task of tasks) {
    if (task.recurrencePreview || !isOpenTask(task) || !(task.recurrenceRule || task.recurrenceSourceUid)) continue
    const uid = recurrenceSeriesUid(task), previous = first.get(uid)
    if (!previous || cycleKey(task).localeCompare(cycleKey(previous)) < 0 || (cycleKey(task) === cycleKey(previous) && task.uid < previous.uid)) first.set(uid, task)
  }
  return tasks.filter(task => !task.recurrencePreview && (!isOpenTask(task) || !(task.recurrenceRule || task.recurrenceSourceUid) || first.get(recurrenceSeriesUid(task))?.uid === task.uid))
}

export type TaskRepeatRule = LunarRepeatRule & {endDate?: string; count?: number}
export function parseTaskRepeatRule(value?: string | null): TaskRepeatRule | null {
  if (!value) return null
  try { const rule = JSON.parse(value); return rule && typeof rule === 'object' ? rule : null } catch { return null }
}
export function taskRepeatLabel(value?: string | null) {
  const rule = parseTaskRepeatRule(value)
  if (!rule) return value ? '自定义重复' : '不重复'
  if(rule.calendar==='lunar')return `每${rule.interval>1?` ${rule.interval} `:''}年 · 农历${rule.lunarLeapMonth?'闰':''}${rule.lunarMonth}月${rule.lunarDay}日`
  const labels: Record<string, string> = {daily:'天',weekdays:'个工作日',weekly:'周',monthly:'月',yearly:'年'}
  const frequency = labels[rule.frequency] || rule.frequency
  return `每${rule.interval > 1 ? ` ${rule.interval} ` : ''}${frequency}${rule.repeatFrom === 'completion' ? ' · 完成后重复' : ''}`
}

export type RecurrencePreview<T> = T & {recurrencePreview?: boolean; recurrenceCurrentUid?: string}
export function assertCurrentRecurringTask(before: RecurringTask, after: RecurringTask, tasks: RecurringTask[]) {
  if (!isOpenTask(before) || isOpenTask(after) || !(before.recurrenceRule || after.recurrenceRule)) return
  const current = currentRecurringTasks(tasks).find(task => isOpenTask(task) && recurrenceSeriesUid(task) === recurrenceSeriesUid(before))
  if (current && current.uid !== before.uid) throw new Error('请先完成或跳过之前的重复周期')
}
