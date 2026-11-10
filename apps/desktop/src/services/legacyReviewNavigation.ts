import type { ReviewPeriod, ReviewRouteQuery } from '@note-flow/core'

const PERIOD_ALIASES: Record<string, ReviewPeriod> = {
  all: 'daily', diary: 'daily', daily: 'daily', 'work-daily': 'daily',
  weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', annual: 'yearly', yearly: 'yearly',
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return scalar(value[0])
  return typeof value === 'string' ? value.trim() : ''
}

export function reviewQueryForLegacyPeriod(value: unknown, source: Record<string, unknown> = {}): ReviewRouteQuery | undefined {
  const raw = scalar(value).replace(/^period:/, '')
  const period = PERIOD_ALIASES[raw]
  if (!period) return undefined
  const projectUid = scalar(source.projectUid || source.project)
  const areaUid = scalar(source.areaUid || source.area)
  const seriesUid = scalar(source.journalSeriesUid || source.seriesUid || source.series)
  const anchor = scalar(source.anchor || source.date)
  const query: ReviewRouteQuery = { period, scope: projectUid ? 'project' : areaUid ? 'area' : 'personal' }
  if (projectUid) query.project = projectUid
  if (areaUid) query.area = areaUid
  if (seriesUid) query.series = seriesUid
  if (anchor) query.anchor = anchor
  const note = scalar(source.note || source.noteUid)
  if (note) query.note = note
  return query
}

export function legacyNotesReviewQuery(query: Record<string, unknown>): ReviewRouteQuery | undefined {
  const scope = scalar(query.scope || query.view)
  const explicitPeriod = scalar(query.period || query.periodType)
  const journalRequest = scalar(query.type) === 'journal' || Boolean(scalar(query.journalSeriesUid || query.seriesUid))
  const legacyPeriod = explicitPeriod || (scope.startsWith('period:') ? scope : '')
  return reviewQueryForLegacyPeriod(legacyPeriod || (journalRequest ? 'daily' : ''), query)
}
