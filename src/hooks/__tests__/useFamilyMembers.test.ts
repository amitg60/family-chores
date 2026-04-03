import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useFamilyMembers } from '../useFamilyMembers'

const fakeMembers = [
  {
    id: 'u1', family_id: 'f1', name: 'דנה', avatar_url: null,
    role: 'player' as const, trust_level: 1, coin_balance: 50,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'u2', family_id: 'f1', name: 'יוסי', avatar_url: null,
    role: 'admin' as const, trust_level: 5, coin_balance: 100,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  },
]

describe('useFamilyMembers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useFamilyMembers())
    expect(result.current.loading).toBe(true)
    expect(result.current.members).toEqual([])
  })

  it('returns family members after fetch', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: fakeMembers, error: null }),
    })
    const { result } = renderHook(() => useFamilyMembers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.members).toEqual(fakeMembers)
  })

  it('returns empty array on error', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS error' } }),
    })
    const { result } = renderHook(() => useFamilyMembers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.members).toEqual([])
  })
})
