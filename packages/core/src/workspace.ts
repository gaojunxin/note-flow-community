export const AREA_KINDS = ['life', 'career', 'personal_projects', 'custom'] as const
export const PROJECT_STATUSES = ['planning', 'active', 'paused', 'completed', 'archived'] as const
export const PROJECT_PROGRESS_MODES = ['task', 'manual'] as const
export const JOURNAL_PERIOD_TYPES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'once'] as const
export const WORKSPACE_SYNC_ENTITY_TYPES = ['area', 'project', 'journal_series', 'project_log'] as const

export type AreaKind = (typeof AREA_KINDS)[number]
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export type ProjectProgressMode = (typeof PROJECT_PROGRESS_MODES)[number]
export type JournalPeriodType = (typeof JOURNAL_PERIOD_TYPES)[number]
export type WorkspaceSyncEntityType = (typeof WORKSPACE_SYNC_ENTITY_TYPES)[number]

export interface WorkspaceSyncFields {
  uid: string
  version: number
  deleted?: boolean
  createdAt?: string
  updatedAt?: string
  syncStatus?: 'synced' | 'pending' | 'conflict'
}

export type WorkspaceMutationAction = 'create' | 'update' | 'delete'

export interface WorkspaceOperation<T extends WorkspaceSyncFields = WorkspaceSyncFields> {
  operationId: string
  entityType: WorkspaceSyncEntityType
  entityUid: string
  action: WorkspaceMutationAction
  baseVersion: number
  payload?: T
  status: 'pending' | 'failed' | 'conflict'
  createdAt: string
  attempts: number
  lastError?: string
}

export interface WorkspaceRepository<T extends WorkspaceSyncFields> {
  list(options?: { includeDeleted?: boolean }): Promise<T[]>
  get(uid: string): Promise<T | undefined>
  create(entity: Omit<T, 'uid' | 'version'> & Partial<Pick<T, 'uid' | 'version'>>): Promise<T>
  update(entity: T): Promise<T>
  remove(entity: T): Promise<T>
  cacheServerSnapshot(entities: T[]): Promise<void>
}

export interface AreaEntity extends WorkspaceSyncFields {
  name: string
  kind: AreaKind
  color?: string | null
  icon?: string | null
  sortOrder: number
  archived: boolean
}

export interface ProjectEntity extends WorkspaceSyncFields {
  areaUid: string
  name: string
  description?: string | null
  status: ProjectStatus
  startDate?: string | null
  targetDate?: string | null
  completedAt?: string | null
  progressMode: ProjectProgressMode
  manualProgress?: number | null
  color?: string | null
  icon?: string | null
  sortOrder: number
  taskTotal?: number
  taskCompleted?: number
}

export interface JournalSeriesEntity extends WorkspaceSyncFields {
  areaUid?: string | null
  projectUid?: string | null
  name: string
  kind: string
  periodType: JournalPeriodType
  templateUid?: string | null
  includeTasks: boolean
  includeNotes: boolean
  includeLogs?: boolean
  includeFocus: boolean
  includeChildReports: boolean
  enabled: boolean
  sortOrder: number
}

export interface ProjectLogEntity extends WorkspaceSyncFields {
  areaUid: string
  projectUid: string
  content: string
  occurredAt: string
  sourceType?: string | null
  sourceUid?: string | null
}

export interface JournalNoteEntity {
  id?: number
  uid: string
  title: string
  content: string
  areaUid?: string | null
  projectUid?: string | null
  journalSeriesUid?: string | null
  periodType: JournalPeriodType
  periodStart: string
  periodEnd: string
  periodKey: string
  reportGeneratedAt?: string | null
  version: number
  updatedAt: string
}

export interface WorkspaceScope {
  areaUid?: string | null
  projectUid?: string | null
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUSES.includes(value as ProjectStatus)
}

export function isJournalPeriodType(value: unknown): value is JournalPeriodType {
  return JOURNAL_PERIOD_TYPES.includes(value as JournalPeriodType)
}

function dateOnly(value: string | Date): Date {
  const [year, month, day] = (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) throw new Error('回顾日期无效')
  return new Date(Date.UTC(year, month - 1, day))
}

const isoDate = (value: Date) => value.toISOString().slice(0, 10)

export function journalPeriod(periodType: JournalPeriodType, anchor: string | Date): { start: string; end: string } {
  const date = dateOnly(anchor)
  let start = new Date(date), end = new Date(date)
  if (periodType === 'weekly') {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); end = new Date(start); end.setUTCDate(end.getUTCDate() + 6)
  } else if (periodType === 'monthly') {
    start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)); end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
  } else if (periodType === 'quarterly') {
    const month = Math.floor(date.getUTCMonth() / 3) * 3
    start = new Date(Date.UTC(date.getUTCFullYear(), month, 1)); end = new Date(Date.UTC(date.getUTCFullYear(), month + 3, 0))
  } else if (periodType === 'yearly') {
    start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); end = new Date(Date.UTC(date.getUTCFullYear(), 11, 31))
  }
  return { start: isoDate(start), end: isoDate(end) }
}

export function journalDraft(series: JournalSeriesEntity, anchor: string | Date): Omit<JournalNoteEntity, 'uid' | 'version' | 'updatedAt'> {
  const { start, end } = journalPeriod(series.periodType, anchor)
  const periodKey = `series:${series.uid}:${series.periodType}:${start}`
  const suffix = series.periodType === 'daily' ? start : series.periodType === 'weekly' ? `${start} 周` : series.periodType === 'monthly' ? start.slice(0, 7) : series.periodType === 'yearly' ? start.slice(0, 4) : series.periodType === 'once' ? start : `${start} ～ ${end}`
  return { title: `${series.name} · ${suffix}`, content: '# 本期记录\n\n', areaUid: series.areaUid || null, projectUid: series.projectUid || null, journalSeriesUid: series.uid, periodType: series.periodType, periodStart: start, periodEnd: end, periodKey }
}

/**
 * A project is the authority for an entity's area. This helper is shared by
 * clients so forms and future local repositories cannot persist a conflicting
 * area/project pair. The server must still enforce the same invariant.
 */
export function scopeForProject(scope: WorkspaceScope, project: Pick<ProjectEntity, 'uid' | 'areaUid'> | null | undefined): WorkspaceScope {
  if (!scope.projectUid) return { areaUid: scope.areaUid || null, projectUid: null }
  if (!project || project.uid !== scope.projectUid) throw new Error('项目不存在或与当前作用域不匹配')
  if (scope.areaUid && scope.areaUid !== project.areaUid) throw new Error('项目不属于所选领域')
  return { areaUid: project.areaUid, projectUid: project.uid }
}

export function validateManualProgress(mode: ProjectProgressMode, value?: number | null): number | null {
  if (mode === 'task') return null
  if (value == null || !Number.isFinite(value) || value < 0 || value > 100) throw new Error('手动进度必须在 0 到 100 之间')
  return Math.round(value)
}
