import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { Profile } from '../../../../types/database'

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'admin1', family_id: 'f1', role: 'admin', name: 'Admin',
      avatar_url: null, coin_balance: 0, trust_level: 5,
      created_at: '', updated_at: '',
    },
  }),
}))

const mockRefetch = vi.fn()
vi.mock('../../../../hooks/useFamilyMembers', () => ({
  useFamilyMembers: vi.fn(() => ({
    members: [], loading: false, error: null, refetch: mockRefetch,
  })),
}))

vi.mock('../../../../hooks/useInvites', () => ({
  useInvites: vi.fn(() => ({
    invites: [], loading: false, refetch: vi.fn(), cancelInvite: vi.fn(), generateInvite: vi.fn(),
  })),
}))

vi.mock('../../../../hooks/useFamily', () => ({
  useFamily: vi.fn(() => ({ family: null, loading: false })),
}))

vi.mock('../../../../hooks/useAliasVote', () => ({
  useAliasVote: vi.fn(() => ({ proposal: null, votes: [], castVote: vi.fn(), resolveIfExpired: vi.fn(), loading: false })),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

import { useFamilyMembers } from '../../../../hooks/useFamilyMembers'
import { supabase } from '../../../../lib/supabase'
import PlayersPage from '../PlayersPage'

const mockUseFamilyMembers = vi.mocked(useFamilyMembers)
const mockRpc = vi.mocked(supabase.rpc)

const player1: Profile = {
  id: 'p1', family_id: 'f1', name: 'דנה', avatar_url: null,
  role: 'player', trust_level: 2, coin_balance: 50,
  created_at: '', updated_at: '',
}
const player2: Profile = {
  id: 'p2', family_id: 'f1', name: 'אבי', avatar_url: null,
  role: 'player', trust_level: 5, coin_balance: 100,
  created_at: '', updated_at: '',
}

function renderPage() {
  return render(<MemoryRouter><PlayersPage /></MemoryRouter>)
}

describe('PlayersPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows player names, coin balances, and trust level badges', () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player1, player2], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText('אבי')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('calls set_trust_level RPC and refetches on promote', async () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player1], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null } as any)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /העלה רמת אמון של דנה/ }))
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('set_trust_level', {
      p_target_user_id: 'p1', p_new_level: 3,
    }))
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('disables promote button when trust level is already 5', () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player2], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('button', { name: /העלה רמת אמון של אבי/ })).toBeDisabled()
  })

  it('opens bonus dialog, submits grant_manual_bonus RPC, and refetches', async () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player1], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null } as any)
    renderPage()
    fireEvent.click(screen.getByText('מענק בונוס'))
    const input = screen.getByRole('spinbutton', { name: /כמות מטבעות/ })
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /^מענק$/ }))
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('grant_manual_bonus', {
      p_target_user_id: 'p1', p_amount: 25, p_family_id: 'f1',
    }))
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('shows error message when trust level RPC fails', async () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player1], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'שגיאת הרשאות' } } as any)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /העלה רמת אמון של דנה/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שגיאת הרשאות'))
  })
})
