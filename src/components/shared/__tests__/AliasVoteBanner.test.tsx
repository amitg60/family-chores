import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FamilyAliasProposal, FamilyAliasVote } from '../../../types/database'

const futureDate = new Date(Date.now() + 3_600_000).toISOString()

const proposal: FamilyAliasProposal = {
  id: 'prop1', family_id: 'fam1', proposed_by: 'user2',
  proposed_alias: 'כהן השולטים',
  expires_at: futureDate,
  status: 'pending', resolved_at: null, created_at: '',
}

const yesVote: FamilyAliasVote = {
  id: 'v1', proposal_id: 'prop1', user_id: 'user2',
  vote: true, voted_at: '',
}

const noVote: FamilyAliasVote = {
  id: 'v2', proposal_id: 'prop1', user_id: 'user3',
  vote: false, voted_at: '',
}

const defaultProps = {
  proposal,
  votes: [yesVote],
  totalMembers: 3,
  currentUserId: 'user1',
  castVote: vi.fn(),
}

import AliasVoteBanner from '../AliasVoteBanner'

describe('AliasVoteBanner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows proposed alias and vote tally', () => {
    render(<AliasVoteBanner {...defaultProps} />)
    expect(screen.getByText(/כהן השולטים/)).toBeInTheDocument()
    expect(screen.getByText(/תומכים: 1/)).toBeInTheDocument()
    expect(screen.getByText(/מתנגדים: 0/)).toBeInTheDocument()
    expect(screen.getByText(/לא הצביעו: 2/)).toBeInTheDocument()
  })

  it('shows vote buttons when current user has not voted', () => {
    render(<AliasVoteBanner {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'כן' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'לא' })).toBeInTheDocument()
  })

  it('hides vote buttons and shows result when current user has voted', () => {
    const myVote: FamilyAliasVote = { ...yesVote, id: 'v3', user_id: 'user1' }
    render(<AliasVoteBanner {...defaultProps} votes={[yesVote, myVote]} />)
    expect(screen.queryByRole('button', { name: 'כן' })).not.toBeInTheDocument()
    expect(screen.getByText(/הצבעת: כן/)).toBeInTheDocument()
  })

  it('calls castVote(true) when כן is clicked', async () => {
    defaultProps.castVote.mockResolvedValue(undefined)
    render(<AliasVoteBanner {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'כן' }))
    await waitFor(() => {
      expect(defaultProps.castVote).toHaveBeenCalledWith(true)
    })
  })

  it('calls castVote(false) when לא is clicked', async () => {
    defaultProps.castVote.mockResolvedValue(undefined)
    render(<AliasVoteBanner {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'לא' }))
    await waitFor(() => {
      expect(defaultProps.castVote).toHaveBeenCalledWith(false)
    })
  })

  it('shows error when castVote throws', async () => {
    defaultProps.castVote.mockRejectedValue(new Error('already voted'))
    render(<AliasVoteBanner {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'כן' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('already voted')
    })
  })
})
