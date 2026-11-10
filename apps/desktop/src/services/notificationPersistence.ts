export type NotificationTarget = '/tasks' | '/focus' | '/settings'
export interface PcNotification {
  id: string
  kind: 'task' | 'focus' | 'sync' | 'notice'
  title: string
  message: string
  createdAt: string
  read: boolean
  target: NotificationTarget
  query?: Record<string, string>
  targetState?: string
  archivedAt?: string | null
  dedupeKey?: string
}
export const notificationStorageKey = (origin: string, profileId: string) => `note-flow-pc-notifications-v2:${origin}:${profileId}`
export const legacyNotificationStorageKey = (profileId: string) => `note-flow-pc-notifications-v2:${profileId}`
export function validateNotificationBackup(value: unknown): PcNotification[] {
  if (!Array.isArray(value) || value.length > 100) throw Error('通知备份格式无效')
  const ids = new Set<string>()
  const allowed = new Set(['id','kind','title','message','createdAt','read','target','query','targetState','archivedAt','dedupeKey'])
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !allowed.has(key)) ||
      !text(row.id,64) || !row.id || ids.has(row.id) || !['task','focus','sync','notice'].includes(row.kind) ||
      !text(row.title,1000) || !text(row.message,100000) || !text(row.createdAt,40) || !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.read !== 'boolean' || !['/tasks','/focus','/settings'].includes(row.target)) throw Error('通知备份字段无效')
    if (row.query !== undefined && (!row.query || typeof row.query !== 'object' || Array.isArray(row.query) || Object.keys(row.query).length > 20 || Object.entries(row.query).some(([key,v]) => key.length > 64 || !text(v,2000)))) throw Error('通知备份链接无效')
    if (row.targetState !== undefined && !text(row.targetState,64) || row.dedupeKey !== undefined && !text(row.dedupeKey,2000) || row.archivedAt != null && (!text(row.archivedAt,40) || !Number.isFinite(Date.parse(row.archivedAt)))) throw Error('通知备份状态无效')
    ids.add(row.id)
  }
  return value as PcNotification[]
}
