import {taskBucket} from '@note-flow/core/task-schedule'
import type { TaskEntity, TaskNoteRelation } from '../services/tasks'

export type TaskListDensity = 'compact'|'comfortable'|'table'

export function effectiveTaskDate(task: Pick<TaskEntity,'startAt'|'dueAt'>) {
  return task.startAt || task.dueAt || null
}

/** 项目页和全局列表共用日程分组：“今天”包含逾期，使用同一开始/截止及本地时区规则。 */
export function matchesTaskScheduleFilter(task: TaskEntity, filter: 'today'|'next7', options: Parameters<typeof taskBucket>[1] = {}) {
  const bucket = taskBucket(task, options)
  return filter === 'today' ? bucket === 'today' || bucket === 'overdue' : bucket === 'next7'
}

export function taskListDensity(value: string | null): TaskListDensity {
  return value === 'compact' || value === 'table' || value === 'comfortable' ? value : 'comfortable'
}

export function validTaskWindow(startAt?: string | null, dueAt?: string | null) {
  return !startAt || !dueAt || new Date(dueAt).getTime() >= new Date(startAt).getTime()
}

export function groupTaskNotes(relations: TaskNoteRelation[]) {
  return {
    sources: relations.filter(value => value.relationType === 'source'),
    references: relations.filter(value => value.relationType !== 'source')
  }
}
