export interface ClassifiableNote {
  type?: string | null
  journalSeriesUid?: string | null
  periodType?: string | null
  journalKind?: string | null
}

const DEDICATED_EXPERIENCE_TYPES = new Set([
  'work_log', 'mindmap', 'excalidraw', 'canvas', 'diagrams', 'drawio',
  'flowchart', 'mermaid', 'knowledge_graph', 'knowledge'
])

/** Periodic records share note storage but belong to Logs or Review experiences. */
export function isPeriodicNote(note: ClassifiableNote = {}): boolean {
  return note.type === 'journal' || Boolean(note.journalSeriesUid || note.periodType)
}

/** Ordinary notes are the records shown in the default Notes workspace.
 * Quick work logs reuse note storage, but belong exclusively to the Logs experience.
 */
export function isRegularNote(note: ClassifiableNote = {}): boolean {
  return !isPeriodicNote(note) && !DEDICATED_EXPERIENCE_TYPES.has(String(note.type || 'note'))
}

/** Daily journals include explicit daily records and legacy untyped journal rows. */
export function isDailyJournal(note: ClassifiableNote = {}): boolean {
  return note.periodType === 'daily' || note.journalKind === 'personal_daily' || (note.type === 'journal' && !note.periodType)
}

/** Reviews are non-daily periodic records such as weekly or annual summaries. */
export function isReviewNote(note: ClassifiableNote = {}): boolean {
  return isPeriodicNote(note) && Boolean(note.periodType && note.periodType !== 'daily')
}
