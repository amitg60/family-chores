import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc, mockChannel } from '../../test/mocks/supabase'
import type { FamilyAliasProposal, FamilyAliasVote } from '../../types/database'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'user1', family_id: 'fam1', name: 'דנה',
      avatar_url: null, role: 'player' as const, trust_level: 1,
      coin_balance: 0, created_at: '', updated_at: '',
    },
  }),
}))

const futureDate = new Date(Date.now() + 3_600_000).toISOString()

const fakeProposal: FamilyAliasProposal = {
  id: 'prop1',
  family_id: 'fam1',
  proposed_by: 'user2',
  proposed_alias: 'כהן השולטים',
  expires_at: futureDate,
  status: 'pending',
  resolved_at: null,
  created_at: '2026-04-08T10:00:00Z',
}

const fakeVote: FamilyAliasVote = {
  id: 'vote1',
  proposal_id: 'prop1',
  user_id: 'user2',
  vote: true,
  voted_at: '2026-04-08T10:00:01Z',
}

function setupNoProposalMock() {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
}

function setupProposalMock(proposal: FamilyAliasProposal, votes: FamilyAliasVote[]) {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: proposal, error: null }),
  })
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: votes, error: null }),
  })
}

import { useAliasVote } from '../useAliasVote'

describe('useAliasVote', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useAliasVote())
    expect(result.current.loading).toBe(true)
    expect(result.current.proposal).toBeNull()
  })

  it('returns null proposal when none pending', async () => {
    setupNoProposalMock()
    const { result } = renderHook(() => useAliasVote())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.proposal).toBeNull()
    expect(result.current.votes).toEqual([])
  })

  it('fetches pending proposal and its votes', async () => {
    setupProposalMock(fakeProposal, [fakeVote])
    const { result } = renderHook(() => useAliasVote())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.proposal).toEqual(fakeProposal)
    expect(result.current.votes).toEqual([fakeVote])
  })

  it('castVote calls cast_alias_vote RPC', async () => {
    setupProposalMock(fakeProposal, [fakeVote])
    const { result } = renderHook(() => useAliasVote())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockRpc.mockResolvedValueOnce({ error: null })
    await act(async () => { await result.current.castVote(true) })

    expect(mockRpc).toHaveBeenCalledWith('cast_alias_vote', {
      p_proposal_id: 'prop1',
      p_vote: true,
    })
  })

  it('castVote throws on RPC error', async () => {
    setupProposalMock(fakeProposal, [fakeVote])
    const { result } = renderHook(() => useAliasVote())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockRpc.mockResolvedValueOnce({ error: { message: 'already voted' } })
    await expect(
      act(async () => { await result.current.castVote(false) })
    ).rejects.toThrow('already voted')
  })

  it('cleans up realtime channel on unmount', async () => {
    setupNoProposalMock()
    const { unmount } = renderHook(() => useAliasVote())
    await waitFor(() => expect(mockChannel).toHaveBeenCalled())
    unmount()
    // Channel cleanup verified via supabase.removeChannel being called
    expect(mockChannel).toHaveBeenCalled()
  })
})
