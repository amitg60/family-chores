import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import type { Family } from '../../types/database'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'user1',
      family_id: 'fam1',
      name: 'דנה',
      avatar_url: null,
      role: 'player' as const,
      trust_level: 1,
      coin_balance: 0,
      created_at: '',
      updated_at: '',
    },
  }),
}))

const fakeFamily: Family = {
  id: 'fam1',
  name: 'משפחת כהן',
  team_name: 'כהן השולטים',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
}

function setupFetchMock(data: Family | null, error: { message: string } | null = null) {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: error ? null : data, error }),
  })
}

import { useFamily } from '../useFamily'

describe('useFamily', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useFamily())
    expect(result.current.loading).toBe(true)
    expect(result.current.family).toBeNull()
  })

  it('fetches family on mount', async () => {
    setupFetchMock(fakeFamily)
    const { result } = renderHook(() => useFamily())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.family).toEqual(fakeFamily)
  })

  it('returns null family when fetch fails', async () => {
    setupFetchMock(null, { message: 'not found' })
    const { result } = renderHook(() => useFamily())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.family).toBeNull()
  })
})
