import type { ReviewPeriod } from '@note-flow/core'

export function localDateKey(value = new Date()) {
  const part = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`
}

export function validAnchor(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return localDateKey()
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? localDateKey() : localDateKey(date)
}

export function moveReviewAnchor(anchor: string, period: ReviewPeriod, amount: number) {
  const date = new Date(`${validAnchor(anchor)}T12:00:00`)
  if (period === 'daily') date.setDate(date.getDate() + amount)
  if (period === 'weekly') date.setDate(date.getDate() + amount * 7)
  if (period === 'monthly' || period === 'quarterly') {
    const day = date.getDate(), targetMonth = date.getMonth() + amount * (period === 'monthly' ? 1 : 3)
    date.setDate(1); date.setMonth(targetMonth)
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(day, lastDay))
  }
  if (period === 'yearly') {
    const month = date.getMonth(), day = date.getDate()
    date.setDate(1); date.setFullYear(date.getFullYear() + amount); date.setMonth(month)
    const lastDay = new Date(date.getFullYear(), month + 1, 0).getDate()
    date.setDate(Math.min(day, lastDay))
  }
  return localDateKey(date)
}

export function reviewPeriodTitle(anchor: string, period: ReviewPeriod) {
  const date = new Date(`${validAnchor(anchor)}T12:00:00`)
  const year = date.getFullYear(), month = date.getMonth() + 1
  if (period === 'daily') return `${year}年${month}月${date.getDate()}日`
  if (period === 'monthly') return `${year}年${month}月`
  if (period === 'quarterly') return `${year}年第${Math.floor(date.getMonth() / 3) + 1}季度`
  if (period === 'yearly') return `${year}年`
  const monday = new Date(date)
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return `${monday.getFullYear()}年${monday.getMonth() + 1}月${monday.getDate()}日 - ${sunday.getMonth() + 1}月${sunday.getDate()}日`
}
