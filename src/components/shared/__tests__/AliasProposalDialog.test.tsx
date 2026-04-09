import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../../test/mocks/supabase'
import { mockRpc } from '../../../test/mocks/supabase'
import type { FamilyAliasProposal } from '../../../types/database'

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  currentAlias: 'כהן הראשונים',
  activeProposal: null as FamilyAliasProposal | null,
  onProposed: vi.fn(),
}

import AliasProposalDialog from '../AliasProposalDialog'

describe('AliasProposalDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows input form when no active proposal', () => {
    render(<AliasProposalDialog {...defaultProps} />)
    expect(screen.getByRole('textbox', { name: /כינוי חדש/i })).toBeInTheDocument()
    expect(screen.getByText('כהן הראשונים')).toBeInTheDocument()
  })

  it('shows active proposal info when one exists', () => {
    const proposal: FamilyAliasProposal = {
      id: 'p1', family_id: 'f1', proposed_by: 'u1',
      proposed_alias: 'כהן השולטים',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      status: 'pending', resolved_at: null, created_at: '',
    }
    render(<AliasProposalDialog {...defaultProps} activeProposal={proposal} />)
    expect(screen.getByText(/כהן השולטים/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('calls propose_alias_change RPC on submit and closes dialog', async () => {
    mockRpc.mockResolvedValueOnce({ error: null })
    render(<AliasProposalDialog {...defaultProps} />)

    fireEvent.change(screen.getByRole('textbox', { name: /כינוי חדש/i }), {
      target: { value: 'כהן המנצחים' },
    })
    fireEvent.click(screen.getByText('הצעת שינוי'))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('propose_alias_change', { p_new_alias: 'כהן המנצחים' })
      expect(defaultProps.onProposed).toHaveBeenCalled()
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows Hebrew error when active_proposal_exists is returned', async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: 'active_proposal_exists' } })
    render(<AliasProposalDialog {...defaultProps} />)

    fireEvent.change(screen.getByRole('textbox', { name: /כינוי חדש/i }), {
      target: { value: 'שם כלשהו' },
    })
    fireEvent.click(screen.getByText('הצעת שינוי'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('כבר קיימת הצעה פעילה')
    })
  })
})
