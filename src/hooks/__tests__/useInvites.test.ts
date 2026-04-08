import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../test/mocks/supabase'
import type { FamilyInvite } from '../../types/database'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'admin1',
      family_id: 'fam1',
      name: 'יוסי',
      avatar_url: null,
      role: 'admin' as const,
      trust_level: 5,
      coin_balance: 0,
      created_at: '',
      updated_at: '',
    },
  }),
}))

const futureDate = new Date(Date.now() + 3_600_000).toISOString()
const pastDate   = new Date(Date.now() - 3_600_000).toISOString()

const activeInvite: FamilyInvite = {
  id: 'inv1',
  family_id: 'fam1',
  created_by: 'admin1',
  role: 'player',
  token: 'abc123',
  expires_at: futureDate,
  used_at: null,
  used_by: null,
  created_at: '2026-04-08T10:00:00Z',
}

const expiredInvite: FamilyInvite = {
  ...activeInvite,
  id: 'inv2',
  expires_at: pastDate,
}

function setupFetchMock(rows: FamilyInvite[]) {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  })
}

import { useInvites } from '../useInvites'

describe('useInvites', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useInvites())
    expect(result.current.loading).toBe(true)
    expect(result.current.invites).toEqual([])
  })

  it('fetches active invites and filters out expired ones', async () => {
    setupFetchMock([activeInvite, expiredInvite])
    const { result } = renderHook(() => useInvites())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.invites).toHaveLength(1)
    expect(result.current.invites[0].id).toBe('inv1')
  })

  it('cancelInvite deletes row and removes from list', async () => {
    setupFetchMock([activeInvite])
    const { result } = renderHook(() => useInvites())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    await act(async () => { await result.current.cancelInvite('inv1') })
    expect(result.current.invites).toEqual([])
  })

  it('generateInvite calls generate_invite_token RPC and returns token', async () => {
    setupFetchMock([])
    const { result } = renderHook(() => useInvites())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockRpc.mockResolvedValueOnce({ data: 'newtoken123', error: null })

    let token: string | undefined
    await act(async () => { token = await result.current.generateInvite('player') })
    expect(mockRpc).toHaveBeenCalledWith('generate_invite_token', { p_role: 'player' })
    expect(token).toBe('newtoken123')
  })

  it('generateInvite throws on RPC error', async () => {
    setupFetchMock([])
    const { result } = renderHook(() => useInvites())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })

    await expect(
      act(async () => { await result.current.generateInvite('admin') })
    ).rejects.toThrow('permission denied')
  })
})
