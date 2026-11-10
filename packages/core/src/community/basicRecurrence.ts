import {zonedDate} from '../reminders'
import {CoreProviderError} from './compatibility'

export interface BasicRepeatRule {
  frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  calendar?: 'solar'
  repeatFrom?: 'due'
  count?: number
  endDate?: string
}
export interface BasicRecurringTask extends Record<string, unknown> {
  uid: string
  startAt?: string | null
  dueAt?: string | null
  timezone?: string | null
  allDay?: boolean
  recurrenceRule?: string | null
  recurrenceSourceUid?: string | null
  recurrenceOccurrenceKey?: string | null
  completed?: boolean
  abandonedAt?: string | null
  recurrenceOrdinal?: number
}
export function basicRepeatCapability(value?: string | null): {kind: 'ordinary' | 'basic' | 'protected'; message: string} {
  if (!value) return {kind: 'ordinary', message: '普通任务'}
  try {parseBasicRepeatRule(value); return {kind: 'basic', message: '基础重复规则，可在本地推进'}}
  catch {return {kind: 'protected', message: '此规则暂不能在本地推进；原文保留，可导出或显式转为普通任务'}}
}
const invalid = (message: string): never => {throw new CoreProviderError('INVALID_CHANGE', message)}
const unsupported = (): never => {throw new CoreProviderError('CAPABILITY_UNAVAILABLE', '该重复规则需要高级组件；原规则已保留')}
const wall = (value: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(value)) return invalid('重复任务必须使用本地墙上日期时间')
  const normalized = value.length === 10 ? `${value}T00:00:00` : value.length === 16 ? `${value.replace(' ', 'T')}:00` : value.replace(' ', 'T')
  const result = new Date(`${normalized}Z`)
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 19) !== normalized) return invalid('重复任务日期无效')
  return result
}
const format = (date: Date, allDay: boolean) => date.toISOString().slice(0, allDay ? 10 : 19)

export function parseBasicRepeatRule(value: string): BasicRepeatRule {
  let parsed: unknown
  try {parsed = JSON.parse(value)} catch {return invalid('重复规则格式无效')}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid('重复规则格式无效')
  const rule = parsed as BasicRepeatRule
  if (Object.keys(rule).some(key => !['frequency','interval','calendar','repeatFrom','count','endDate'].includes(key))) return unsupported()
  if ((rule.calendar && rule.calendar !== 'solar') || (rule.repeatFrom && rule.repeatFrom !== 'due') || !['daily','weekdays','weekly','monthly','yearly'].includes(rule.frequency)) return unsupported()
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 365) return invalid('重复间隔无效')
  if (rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > 100000)) return invalid('重复次数无效')
  if (rule.endDate !== undefined) {
    if (typeof rule.endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rule.endDate)) return invalid('重复截止日期无效')
    wall(rule.endDate)
  }
  return {...rule}
}

/** Calendar arithmetic uses UTC only as a wall-time container, never as the task zone. */
export function nextBasicOccurrence(current: BasicRecurringTask, source: BasicRecurringTask): {startAt: string | null; dueAt: string | null; occurrenceKey: string; ordinal: number} | undefined {
  if (!current.recurrenceRule) return undefined
  const rule = parseBasicRepeatRule(current.recurrenceRule)
  const ordinal = current.recurrenceOrdinal ?? (current.uid === source.uid ? 1 : undefined)
  if (!ordinal || !Number.isInteger(ordinal) || ordinal < 1) return invalid('旧重复系列缺少期次编号，需要恢复后再推进')
  if (rule.count && ordinal >= rule.count) return undefined
  const anchorValue = current.startAt || current.dueAt
  const sourceValue = source.recurrenceOccurrenceKey?.split('@')[0] || source.startAt || source.dueAt
  if (!anchorValue || !sourceValue) return invalid('重复任务缺少日期')
  const actual = wall(anchorValue)
  const planned = wall(current.recurrenceOccurrenceKey?.split('@')[0] || anchorValue)
  const origin = wall(sourceValue)
  const next = new Date(planned)
  if (rule.frequency === 'daily') next.setUTCDate(next.getUTCDate() + rule.interval)
  else if (rule.frequency === 'weekly') next.setUTCDate(next.getUTCDate() + rule.interval * 7)
  else if (rule.frequency === 'weekdays') {
    for (let remaining = rule.interval; remaining;) {next.setUTCDate(next.getUTCDate() + 1); if (![0, 6].includes(next.getUTCDay())) remaining--}
  } else if (rule.frequency === 'monthly') {
    next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + rule.interval)
    next.setUTCDate(Math.min(origin.getUTCDate(), new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()))
  } else {
    next.setUTCDate(1); next.setUTCFullYear(next.getUTCFullYear() + rule.interval); next.setUTCMonth(origin.getUTCMonth())
    next.setUTCDate(Math.min(origin.getUTCDate(), new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()))
  }
  if (rule.endDate && format(next, true) > rule.endDate) return undefined
  const zone = current.timezone || 'UTC'
  try {new Intl.DateTimeFormat('en', {timeZone: zone}).format(next)} catch {return invalid('任务时区无效')}
  const shift = next.getTime() - actual.getTime()
  const result = {
    startAt: current.startAt ? format(new Date(wall(current.startAt).getTime() + shift), Boolean(current.allDay)) : null,
    dueAt: current.dueAt ? format(new Date(wall(current.dueAt).getTime() + shift), Boolean(current.allDay)) : null,
    occurrenceKey: `${format(next, Boolean(current.allDay))}@${zone}`, ordinal: ordinal + 1,
  }
  if (!current.allDay) {
    for (const value of [result.startAt, result.dueAt]) {
      if (!value) continue
      const instant = zonedDate(value, zone)
      if (!instant) return invalid('无法解析下一期的时区日期')
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type,part.value]))
      if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` !== value) return invalid('下一期落在夏令时不存在的时间，请先调整计划')
    }
  }
  return result
}

export async function basicOccurrenceUid(seriesUid: string, occurrenceKey: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([seriesUid, occurrenceKey])))).slice(0, 16)
  bytes[6] = (bytes[6] & 15) | 128
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
