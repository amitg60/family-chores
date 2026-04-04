export function getCurrentWeekStart(): string {
  const now = new Date()
  const utcDay = now.getUTCDay() // 0 = Sunday
  const start = new Date(now)
  start.setUTCDate(now.getUTCDate() - utcDay)
  start.setUTCHours(0, 0, 0, 0)
  return start.toISOString().split('T')[0]
}
