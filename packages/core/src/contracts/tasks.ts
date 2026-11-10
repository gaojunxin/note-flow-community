/** Existing task data; synchronization execution is supplied separately. */
export interface TaskEntity {
  id?: number
  uid: string
  title: string
  description?: string
  listName?: string
  taskListId?: number | null
  taskListUid?: string | null
  parentTaskUid?: string | null
  sortOrder?: number
  areaUid?: string | null
  projectUid?: string | null
  priority: number
  estimatedMinutes?: number | null
  completed: boolean
  version: number
  dueAt?: string | null
  startAt?: string | null
  completedAt?: string | null
  abandonedAt?: string | null
  allDay?: boolean
  recurrenceSourceUid?: string | null
  recurrenceOccurrenceKey?: string | null
  recurrenceRule?: string | null
  timezone?: string | null
  reminderOffsetsMinutes?: number[]
  tagIds?: number[]
  deleted?: boolean
  syncStatus?: 'synced'|'pending'|'conflict'
  createdAt?: string
  updatedAt?: string
}
