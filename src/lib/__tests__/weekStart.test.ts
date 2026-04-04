import { describe, it, expect, vi, afterEach } from 'vitest'
import { getCurrentWeekStart } from '../weekStart'

describe('getCurrentWeekStart', () => {
  afterEach(() => vi.useRealTimers())

  it('returns the Sunday of the week when called on Wednesday', () => {
    // 2026-04-08 is a Wednesday (UTC); 2026-04-05 is the Sunday
    vi.setSystemTime(new Date('2026-04-08T12:00:00Z'))
    expect(getCurrentWeekStart()).toBe('2026-04-05')
  })

  it('returns the same day when called on Sunday', () => {
    vi.setSystemTime(new Date('2026-04-05T10:00:00Z'))
    expect(getCurrentWeekStart()).toBe('2026-04-05')
  })

  it('returns the preceding Sunday when called on Saturday', () => {
    // 2026-04-11 is Saturday, preceding Sunday is 2026-04-05
    vi.setSystemTime(new Date('2026-04-11T20:00:00Z'))
    expect(getCurrentWeekStart()).toBe('2026-04-05')
  })
})
