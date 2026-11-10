type ScheduledTask = {
  allDay?: boolean; dueDate?: string | null; dueAt?: string | null; startAt?: string | null
  timezone?: string | null; listName?: string; completed?: boolean; abandonedAt?: string | null
}
const pad = (value: number) => String(value).padStart(2, '0')
const dateKey = ({ year, month, day }: Record<string, number>) => `${year}-${pad(month)}-${pad(day)}`
const zonedFormatters = new Map<string, Intl.DateTimeFormat>()

export function zonedParts(instant: Date, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!zonedFormatters.has(timeZone)) {
    if (zonedFormatters.size >= 8) zonedFormatters.delete(zonedFormatters.keys().next().value!)
    zonedFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }))
  }
  const values = Object.fromEntries(zonedFormatters.get(timeZone)!.formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]))
  return values
}

export function adaptTask<T extends ScheduledTask>(task: T) {
  const allDay = task.allDay === true || Boolean(task.dueDate) || /^\d{4}-\d{2}-\d{2}$/.test(task.dueAt || '')
  const allDayDate = (value: string) => /Z$|[+-]\d{2}:?\d{2}$/.test(value)
    ? dateKey(zonedParts(new Date(value), task.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)) : value.slice(0, 10)
  return { ...task, allDay, dueDate: task.dueDate || (allDay ? allDayDate(String(task.dueAt || '')) : null), listName: task.listName || '收集箱' }
}

function dueInfo(task: ScheduledTask, timeZone: string) {
  const adapted = adaptTask(task)
  if (adapted.allDay) return adapted.dueDate ? { allDay: true, date: adapted.dueDate } : null
  if (!adapted.dueAt) return null
  const source = String(adapted.dueAt)
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(source)) {
    const parts = zonedParts(new Date(source), timeZone)
    return { allDay: false, date: dateKey(parts), wall: `${dateKey(parts)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` }
  }
  return { allDay: false, date: source.slice(0, 10), wall: source.replace(' ', 'T').slice(0, 19) }
}

function startInfo(task: ScheduledTask, timeZone: string) {
  if (!task.startAt) return null
  const source = String(task.startAt)
  if (task.allDay) return { allDay: true, date: /Z$|[+-]\d{2}:?\d{2}$/.test(source) ? dateKey(zonedParts(new Date(source), task.timezone || timeZone)) : source.slice(0, 10) }
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(source)) {
    const parts = zonedParts(new Date(source), timeZone)
    return { allDay: false, date: dateKey(parts), wall: `${dateKey(parts)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` }
  }
  return { allDay: false, date: source.slice(0, 10), wall: source.replace(' ', 'T').slice(0, 19) }
}

const addDays = (date: Date, days: number) => { const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() + days); return copy.toISOString().slice(0, 10) }

export function taskTimingPresentation(task: ScheduledTask, { now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const adapted = adaptTask(task)
  const start = startInfo(adapted, timeZone)
  const due = dueInfo(adapted, timeZone)
  const display = start || due
  if (!display) return { hasDeadline: false, anchorKind: '', status: '', statusKind: '', dateLabel: '添加日期', timeLabel: '还没有安排时间' }
  const parts = zonedParts(now, timeZone)
  const today = dateKey(parts)
  const tomorrow = addDays(new Date(`${today}T00:00:00Z`), 1)
  const nowWall = `${today}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
  const overdue = !adapted.completed && ((due && (due.allDay ? due.date < today : due.wall! < nowWall)) || display.date < today)
  const status = adapted.completed ? '已完成' : overdue ? '已逾期' : display.date === today ? '今天' : display.date === tomorrow ? '明天' : ''
  const date = new Date(`${display.date}T12:00:00`)
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(date)
  const timeLabel = display.allDay ? '全天' : display.wall!.slice(11, 16)
  return { hasDeadline: true, anchorKind: start ? 'start' : 'due', status, statusKind: overdue ? 'overdue' : adapted.completed ? 'completed' : 'upcoming', dateLabel, timeLabel }
}

export function taskBucket(task: ScheduledTask, { now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const adapted = adaptTask(task)
  if (adapted.abandonedAt) return 'abandoned'
  if (adapted.completed) return 'completed'
  const start = startInfo(adapted, timeZone)
  const due = dueInfo(adapted, timeZone)
  const display = start || due
  if (!display) return 'inbox'
  const parts = zonedParts(now, timeZone)
  const today = dateKey(parts)
  const nowWall = `${today}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
  if ((due && (due.allDay ? due.date < today : due.wall! < nowWall)) || display.date < today) return 'overdue'
  if (display.date === today) return 'today'
  if (display.date <= addDays(new Date(`${today}T00:00:00Z`), 7)) return 'next7'
  return 'calendar'
}

