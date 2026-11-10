import type { JournalPeriodType, JournalSeriesEntity } from './workspace'

/** The five navigable review periods. `once` remains a storage period, not a workbench tab. */
export const REVIEW_PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const
export const REVIEW_SCOPE_KINDS = ['personal', 'area', 'project'] as const
export const REVIEW_RECORD_INTENTS = ['diary', 'project_progress', 'work_daily', 'note', 'task'] as const

export type ReviewPeriod = (typeof REVIEW_PERIODS)[number]
export type ReviewScopeKind = (typeof REVIEW_SCOPE_KINDS)[number]
export type ReviewRecordIntent = (typeof REVIEW_RECORD_INTENTS)[number]

export type ReviewScope =
  | { kind: 'personal' }
  | { kind: 'area'; areaUid: string }
  | { kind: 'project'; areaUid?: string; projectUid: string }

export interface ReviewRouteState {
  period: ReviewPeriod
  anchor?: string
  scope: ReviewScope
  seriesUid?: string
}

export type ReviewRouteQuery = Record<string, string>

export interface ReviewSeriesIdentity {
  seriesUid: string
  periodKey: string
}

export const REVIEW_PERIOD_LABELS: Record<ReviewPeriod, string> = {
  daily: '日', weekly: '周', monthly: '月', quarterly: '季', yearly: '年',
}

/** Product semantics for the shared quick-record menu. */
export const REVIEW_RECORD_SEMANTICS: Record<ReviewRecordIntent, {
  label: string
  entityType: 'journal' | 'project_log' | 'note' | 'task'
  availability: 'daily' | 'all'
  cardinality: 'one_per_series_period' | 'many'
}> = {
  diary: { label: '写日记', entityType: 'journal', availability: 'daily', cardinality: 'one_per_series_period' },
  project_progress: { label: '记录工作进展', entityType: 'project_log', availability: 'daily', cardinality: 'many' },
  work_daily: { label: '填写工作日报', entityType: 'journal', availability: 'daily', cardinality: 'one_per_series_period' },
  note: { label: '新建笔记', entityType: 'note', availability: 'all', cardinality: 'many' },
  task: { label: '新建任务', entityType: 'task', availability: 'all', cardinality: 'many' },
}

export function isReviewPeriod(value: unknown): value is ReviewPeriod {
  return REVIEW_PERIODS.includes(value as ReviewPeriod)
}

function scalar(value: unknown): string | undefined {
  if (Array.isArray(value)) return scalar(value[0])
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseReviewRouteQuery(query: Record<string, unknown>): ReviewRouteState {
  const periodValue = scalar(query.period)
  const period = isReviewPeriod(periodValue) ? periodValue : 'daily'
  const anchor = scalar(query.anchor)
  const requestedScope = scalar(query.scope)
  const areaUid = scalar(query.area)
  const projectUid = scalar(query.project)
  const seriesUid = scalar(query.series)
  const scope: ReviewScope = requestedScope === 'project' && projectUid
    ? { kind: 'project', ...(areaUid ? { areaUid } : {}), projectUid }
    : requestedScope === 'area' && areaUid
      ? { kind: 'area', areaUid }
      : { kind: 'personal' }
  return { period, ...(anchor ? { anchor } : {}), scope, ...(seriesUid ? { seriesUid } : {}) }
}

export function reviewRouteQuery(state: ReviewRouteState): ReviewRouteQuery {
  const query: ReviewRouteQuery = { period: state.period, scope: state.scope.kind }
  if (state.anchor) query.anchor = state.anchor
  if (state.seriesUid) query.series = state.seriesUid
  if (state.scope.kind === 'area') query.area = state.scope.areaUid
  if (state.scope.kind === 'project') {
    query.project = state.scope.projectUid
    if (state.scope.areaUid) query.area = state.scope.areaUid
  }
  return query
}

/** A periodic journal is idempotent only within both its series and period key. */
export function reviewSeriesIdentity(seriesUid: string, periodKey: string): ReviewSeriesIdentity {
  const normalizedSeries = seriesUid.trim()
  const normalizedPeriod = periodKey.trim()
  if (!normalizedSeries || !normalizedPeriod) throw new Error('回顾实例必须包含系列和周期标识')
  return { seriesUid: normalizedSeries, periodKey: normalizedPeriod }
}

export function seriesMatchesReview(series: Pick<JournalSeriesEntity, 'uid' | 'periodType' | 'areaUid' | 'projectUid'>, state: ReviewRouteState): boolean {
  if (series.periodType !== state.period as JournalPeriodType) return false
  if (state.seriesUid && series.uid !== state.seriesUid) return false
  if (state.scope.kind === 'personal') return !series.areaUid && !series.projectUid
  if (state.scope.kind === 'area') return series.areaUid === state.scope.areaUid && !series.projectUid
  return series.projectUid === state.scope.projectUid && (!state.scope.areaUid || series.areaUid === state.scope.areaUid)
}
