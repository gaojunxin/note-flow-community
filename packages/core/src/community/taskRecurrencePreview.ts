import {basicRepeatCapability, nextBasicOccurrence, type BasicRecurringTask} from './basicRecurrence'
import {currentRecurringTasks, isOpenTask, recurrenceSeriesUid, type RecurringTask, type RecurrencePreview} from '../taskRecurrenceShared'
export * from '../taskRecurrenceShared'

/** Read-only calendar projection: no host, queue, persistence or reminder scheduling. */
export function previewRecurringTasks<T extends RecurringTask>(tasks: T[], throughDate: string, fromDate = ''): RecurrencePreview<T>[] {
  const visible: RecurrencePreview<T>[] = currentRecurringTasks(tasks).map(task => ({...task}))
  const initial = [...visible]
  for (const current of initial.filter(task => isOpenTask(task) && task.recurrenceRule)) {
    const series = tasks.filter(task => recurrenceSeriesUid(task) === recurrenceSeriesUid(current) && !task.recurrencePreview)
    if (basicRepeatCapability(current.recurrenceRule).kind !== 'basic') {
      // Existing advanced cycles remain data; never synthesize their schedule.
      for (const existing of series) if (!visible.some(row => row.uid === existing.uid)) visible.push({...existing})
      continue
    }
    const anchor = (task: RecurringTask) => task.recurrenceOccurrenceKey?.split('@')[0] || task.startAt || task.dueAt || ''
    const source = series.find(task => task.uid === recurrenceSeriesUid(current)) || current
    const sourceTask = {...source} as unknown as BasicRecurringTask
    let cursor = {...current, recurrenceOrdinal: (current as unknown as BasicRecurringTask).recurrenceOrdinal ?? Math.max(1, series.filter(task => anchor(task) <= anchor(current)).length)} as unknown as BasicRecurringTask
    for (let guard = 0; guard < 100000; guard++) {
      let next: ReturnType<typeof nextBasicOccurrence>
      try {next = nextBasicOccurrence(cursor, sourceTask)} catch {break}
      if (!next) break
      const date = next.occurrenceKey.slice(0, 10)
      if (date > throughDate) break
      const existing = series.find(task => anchor(task).replace(' ', 'T') === next.occurrenceKey.split('@')[0])
      cursor = {...cursor, startAt: next.startAt, dueAt: next.dueAt, recurrenceOccurrenceKey: next.occurrenceKey, recurrenceOrdinal: next.ordinal}
      if (fromDate && date < fromDate) continue
      visible.push({...current, ...existing, uid: `preview:${current.uid}:${next.occurrenceKey}`, startAt: existing?.startAt || next.startAt, dueAt: existing?.dueAt || next.dueAt, recurrencePreview: true, recurrenceCurrentUid: current.uid})
    }
  }
  return visible
}
