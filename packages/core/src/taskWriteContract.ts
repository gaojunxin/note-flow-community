/** Local task writes use opaque UIDs; wire UUID validation belongs to the protocol boundary. */
export interface TaskListScope {
  uid: string
  id?: number
  name?: string
  areaUid?: string | null
  projectUid?: string | null
  deleted?: boolean
}

/** Resolve a selected list before staging an operation. Explicit scope changes must agree. */
export function taskWriteScope<T extends Record<string, any>>(task: T, lists: readonly TaskListScope[]): T {
  for (const field of ['uid', 'taskListUid', 'areaUid', 'projectUid', 'parentTaskUid', 'recurrenceSourceUid']) {
    const value = task[field]
    if (value !== undefined && value !== null && (typeof value !== 'string' || !value.trim())) {
      throw new Error(`任务字段 ${field} 必须是非空 UID 或 null`)
    }
  }
  if (task.taskListId !== undefined && task.taskListId !== null &&
      (!Number.isSafeInteger(task.taskListId) || task.taskListId <= 0)) throw new Error('任务清单 ID 无效')
  if (!task.taskListUid && !task.taskListId) return { ...task }
  const matches = lists.filter(list => !list.deleted && (task.taskListUid ? list.uid === task.taskListUid : list.id === task.taskListId))
  if (matches.length !== 1) throw new Error('所选任务清单不可用，请刷新清单后重新选择')
  const list = matches[0]!
  if (task.taskListId != null && list.id != null && task.taskListId !== list.id) throw new Error('任务清单 ID 与 UID 不一致，请重新选择')
  for (const field of ['areaUid', 'projectUid'] as const) {
    const expected = list[field] ?? null
    if (expected !== null && (typeof expected !== 'string' || !expected.trim())) throw new Error('任务清单归属信息无效，请刷新清单')
    if (task[field] !== undefined && task[field] !== expected) throw new Error('任务与清单必须属于同一领域/项目，请重新选择任务归属')
  }
  return { ...task, taskListUid: list.uid, ...(list.id != null ? {taskListId:list.id} : {}), areaUid:list.areaUid ?? null, projectUid:list.projectUid ?? null }
}

/** Validate without coercion before a local transaction can replace a good queue entry. */
export function assertTaskWriteFields(task: Record<string, any>): void {
  if (typeof task.title !== 'string' || !task.title.trim()) throw new Error('任务标题不能为空')
  if (task.version !== undefined && (!Number.isSafeInteger(task.version) || task.version < 0 || task.version > 2147483647)) throw new Error('任务版本必须是非负整数')
  for (const field of ['completed', 'allDay']) {
    if (task[field] !== undefined && typeof task[field] !== 'boolean') throw new Error(`任务字段 ${field} 必须是布尔值`)
  }
  for (const field of ['startAt', 'dueAt', 'completedAt', 'abandonedAt']) {
    const value = task[field]
    if (value !== undefined && value !== null && (typeof value !== 'string' || !value.trim())) throw new Error(`任务日期 ${field} 必须是日期字符串或 null`)
  }
}
