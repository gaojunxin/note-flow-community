export const DEFAULT_REMINDER_OFFSETS = [0] as const
export const REMINDER_PRESETS = [0, 10, 30, 60, 1440, 10080] as const
export const MAX_REMINDERS_PER_TASK = 5
export const MAX_REMINDER_OFFSET_MINUTES = 365 * 24 * 60

export type ReminderTask = {
  uid?: string
  title?: string
  dueAt?: string | null
  startAt?: string | null
  dueDate?: string | null
  allDay?: boolean
  timezone?: string | null
  completed?: boolean
  abandonedAt?: string | null
  deleted?: boolean
  reminderOffsetsMinutes?: number[] | null
}

export type ReminderOccurrence = { offsetMinutes: number; fireAt: Date; dueAt: Date }

export function normalizeReminderOffsets(values: unknown, fallback: readonly number[] = DEFAULT_REMINDER_OFFSETS): number[] {
  const source = Array.isArray(values) ? values : [...fallback]
  const result = [...new Set(source.map(Number).filter(Number.isInteger))].sort((a, b) => a - b)
  if (result.length > MAX_REMINDERS_PER_TASK) throw new Error(`每个任务最多设置 ${MAX_REMINDERS_PER_TASK} 个提醒`)
  if (result.some(value => value < 0 || value > MAX_REMINDER_OFFSET_MINUTES)) throw new Error('提醒提前量必须在 0 到 365 天之间')
  return result
}

function partsAt(epoch: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch))
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)])) as Record<string, number>
}

/** Converts a wall-clock timestamp in an IANA zone to an absolute instant. */
export function zonedDate(value: string, timezone?: string | null): Date | null {
  if (/[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(String(value || ''))) {
    const instant = new Date(value)
    return Number.isNaN(instant.getTime()) ? null : instant
  }
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!match) return null
  const target = { year: +match[1], month: +match[2], day: +match[3], hour: +(match[4] || 0), minute: +(match[5] || 0), second: +(match[6] || 0) }
  if (!timezone) { const local = new Date(target.year, target.month - 1, target.day, target.hour, target.minute, target.second); return Number.isNaN(local.getTime()) ? null : local }
  try {
    let epoch = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second)
    for (let attempt = 0; attempt < 3; attempt++) {
      const actual = partsAt(epoch, timezone)
      const wantedUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second)
      const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
      const delta = wantedUtc - actualUtc
      epoch += delta
      if (!delta) break
    }
    return new Date(epoch)
  } catch { return null }
}

export function taskReminderOccurrences(task: ReminderTask): ReminderOccurrence[] {
  const anchor = task?.dueAt || task?.startAt
  if (!anchor || task.completed || task.deleted || task.abandonedAt) return []
  const source = String(anchor)
  const wallClock = task.allDay ? `${source.slice(0, 10)} 09:00:00` : source
  const dueAt = zonedDate(wallClock, task.timezone)
  if (!dueAt) return []
  return normalizeReminderOffsets(task.reminderOffsetsMinutes).map(offsetMinutes => ({ offsetMinutes, dueAt, fireAt: new Date(dueAt.getTime() - offsetMinutes * 60_000) }))
}

export function reminderOffsetLabel(minutes: number): string {
  if (minutes === 0) return '到期时'
  if (minutes % 10080 === 0) return `提前 ${minutes / 10080} 周`
  if (minutes % 1440 === 0) return `提前 ${minutes / 1440} 天`
  if (minutes % 60 === 0) return `提前 ${minutes / 60} 小时`
  return `提前 ${minutes} 分钟`
}
