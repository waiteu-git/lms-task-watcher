import { ONE_DAY_MS, SEVEN_DAYS_MS } from '../constants'

export function formatDeadline(deadline: string | null): string {
  if (!deadline) {
    return '期限なし'
  }

  const date = new Date(deadline)

  if (Number.isNaN(date.getTime())) {
    return '期限なし'
  }

  return `${date.getMonth() + 1}/${date.getDate()} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return '未更新'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '未更新'
  }

  return `${date.getMonth() + 1}/${date.getDate()} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function getElapsedText(value: string | null): string {
  if (!value) {
    return '未更新'
  }

  const diff = Date.now() - new Date(value).getTime()

  if (diff < 0 || Number.isNaN(diff)) {
    return '不明'
  }

  const minutes = Math.floor(diff / 60_000)

  if (minutes < 1) {
    return 'たった今'
  }

  if (minutes < 60) {
    return `${minutes}分前`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours < 24) {
    return remainingMinutes === 0
      ? `${hours}時間前`
      : `${hours}時間${remainingMinutes}分前`
  }

  const days = Math.floor(hours / 24)

  return `${days}日前`
}

export function getRemaining(deadline: string | null): string {
  if (!deadline) {
    return ''
  }

  const diff = new Date(deadline).getTime() - Date.now()

  if (diff <= 0) {
    return '期限切れ'
  }

  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)

  if (hours < 24) {
    return `${hours}時間${minutes}分`
  }

  return `${Math.floor(hours / 24)}日後`
}

export function getEndOfTomorrow(): number {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

export function isWithin24Hours(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const diff = new Date(deadline).getTime() - Date.now()

  return diff > 0 && diff <= ONE_DAY_MS
}

export function isTomorrowOrEarlierAfter24Hours(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const time = new Date(deadline).getTime()
  const diff = time - Date.now()

  return diff > ONE_DAY_MS && time <= getEndOfTomorrow()
}

export function isWithinThisWeekAfterTomorrow(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const time = new Date(deadline).getTime()
  const diff = time - Date.now()

  return diff > ONE_DAY_MS && time > getEndOfTomorrow() && diff <= SEVEN_DAYS_MS
}

export function isLaterThanThisWeek(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const diff = new Date(deadline).getTime() - Date.now()

  return diff > SEVEN_DAYS_MS
}
