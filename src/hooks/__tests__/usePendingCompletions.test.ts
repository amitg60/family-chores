import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { usePendingCompletions } from '../usePendingCompletions'

const fakeCompletion = {
  id: 'comp1',
  chore_assignment_id: 'a1',
  completed_by: 'p1',
  photo_url: 'p1/photo.webp',
  status: 'pending',
  completed_at: '2026-04-08T10:00:00Z',
  chore_assignments: {
    chore_id: 'c1',
    chores: { title: 'כלי מטבח', coin_value: 10 },
  },
  profiles: { name: 'דנה' },
}

// Builds a mock for: .from(...).select(...).eq('status', 'pending').order(...)
function makeChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.order = vi.fn().mockResolvedValue(resolvedValue)
  return chain
}

describe('usePendingCompletions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts with loading=true', () => {
    mockFrom.mockReturnValue(makeChain(new Promise(() => {})))
    const { result } = renderHook(() => usePendingCompletions())
    expect(result.current.loading).toBe(true)
  })

  it('returns completions on success', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [fakeCompletion], error: null }))
    const { result } = renderHook(() => usePendingCompletions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.completions).toHaveLength(1)
    expect(result.current.completions[0].id).toBe('comp1')
    expect(result.current.completions[0].chore_assignments.chores.title).toBe('כלי מטבח')
    expect(result.current.completions[0].profiles.name).toBe('דנה')
  })

  it('returns error string on query failure', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'query failed' } }))
    const { result } = renderHook(() => usePendingCompletions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('query failed')
    expect(result.current.completions).toHaveLength(0)
  })
})
