import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockRpc, mockFrom } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useRewards', () => ({
  useRewards: vi.fn(() => ({ rewards: [], loading: false, error: null, refetch: mockRefetch })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1', coin_balance: 50 } }),
}))
vi.mock('../../../../hooks/useMyProposals', () => ({
  useMyProposals: vi.fn(() => ({ proposals: [], refetch: vi.fn() })),
}))

import { useRewards } from '../../../../hooks/useRewards'
import { useMyProposals } from '../../../../hooks/useMyProposals'
import RewardStorePage from '../RewardStorePage'
import type { Reward } from '../../../../types/database'

const mockUseRewards = vi.mocked(useRewards)
const mockUseMyProposals = vi.mocked(useMyProposals)

const fakeReward = {
  id: 'r1', family_id: 'f1', title: 'גלידה', description: 'גלידת וניל',
  coin_cost: 20, type: 'store' as const, status: 'active' as const,
  proposed_by: null, approved_by: null,
  proposal_rejection_reason: null,
  stock: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const expensiveReward = { ...fakeReward, id: 'r2', title: 'נסיעה לפארק', coin_cost: 100 }

const pendingRewardProposal: Reward = {
  ...fakeReward,
  id: 'pr1', title: 'ביקור בפארק שעשועים',
  status: 'pending_approval', proposed_by: 'p1', type: 'store',
}

const rejectedRewardProposal: Reward = {
  ...pendingRewardProposal,
  id: 'pr2', title: 'טיול לים',
  status: 'archived',
  proposal_rejection_reason: 'יקר מדי',
}

const rejectedNoReason: Reward = {
  ...rejectedRewardProposal,
  id: 'pr3', title: 'קונצרט',
  proposal_rejection_reason: null,
}

function renderPage() {
  return render(<MemoryRouter><RewardStorePage /></MemoryRouter>)
}

describe('RewardStorePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMyProposals.mockReturnValue({ proposals: [], refetch: vi.fn() })
  })

  it('shows loading spinner while loading', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: true, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no store rewards', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('אין פרסים זמינים כרגע.')).toBeInTheDocument()
  })

  it('shows reward title, description, and coin cost', () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('גלידה')).toBeInTheDocument()
    expect(screen.getByText('גלידת וניל')).toBeInTheDocument()
    expect(screen.getByText(/20 מטבעות/)).toBeInTheDocument()
  })

  it('redeem button opens confirmation dialog', async () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'אישור מימוש' })).toBeInTheDocument()
  })

  it('confirming redemption calls redeem_reward RPC and shows success', async () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))
    await userEvent.click(screen.getByRole('button', { name: 'אשר מימוש' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('redeem_reward', { p_reward_id: 'r1' })
    })
    await waitFor(() =>
      expect(screen.getByText(/גלידה הוזמן בהצלחה/)).toBeInTheDocument()
    )
  })

  it('shows insufficient balance error when RPC fails with balance message', async () => {
    mockUseRewards.mockReturnValue({ rewards: [expensiveReward], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'Insufficient coin balance' } })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))
    await userEvent.click(screen.getByRole('button', { name: 'אשר מימוש' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('אין מספיק מטבעות')
    )
  })

  it('shows out of stock error when RPC fails with stock message', async () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'out of stock' } })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))
    await userEvent.click(screen.getByRole('button', { name: 'אשר מימוש' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('הפרס אזל מהמלאי')
    )
  })

  it('cancelling dialog closes it without calling RPC', async () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }))

    expect(mockRpc).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows "הצע מתנה חדשה" button', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('button', { name: 'הצע מתנה חדשה' })).toBeInTheDocument()
  })

  it('"הצע מתנה חדשה" button opens proposal dialog', async () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'הצע מתנה חדשה' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'הצע פרס חדש' })).toBeInTheDocument()
  })

  it('proposal form submit with valid data calls supabase insert', async () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert: mockInsert })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'הצע מתנה חדשה' }))
    await userEvent.type(screen.getByLabelText('כותרת'), 'אייפד חדש')
    await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
    await userEvent.type(screen.getByLabelText('עלות במטבעות'), '50')
    await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('rewards')
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        title: 'אייפד חדש',
        coin_cost: 50,
        status: 'pending_approval',
        proposed_by: 'p1',
        family_id: 'f1',
      }))
    })
  })

  it('proposal form submit success closes dialog', async () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'הצע מתנה חדשה' }))
    await userEvent.type(screen.getByLabelText('כותרת'), 'אייפד חדש')
    await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
    await userEvent.type(screen.getByLabelText('עלות במטבעות'), '50')
    await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('proposal form submit error shows error and keeps dialog open', async () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } }) })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'הצע מתנה חדשה' }))
    await userEvent.type(screen.getByLabelText('כותרת'), 'אייפד חדש')
    await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
    await userEvent.type(screen.getByLabelText('עלות במטבעות'), '50')
    await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשליחת ההצעה')
  })

  it('shows "ההצעות שלי" section when player has proposals', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    mockUseMyProposals.mockReturnValue({ proposals: [pendingRewardProposal], refetch: vi.fn() })
    renderPage()
    expect(screen.getByText('ההצעות שלי')).toBeInTheDocument()
  })

  it('"ההצעות שלי" section hidden when no proposals', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.queryByText('ההצעות שלי')).not.toBeInTheDocument()
  })

  it('pending proposal shows "ממתין לאישור" badge', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    mockUseMyProposals.mockReturnValue({ proposals: [pendingRewardProposal], refetch: vi.fn() })
    renderPage()
    expect(screen.getByText('ביקור בפארק שעשועים')).toBeInTheDocument()
    expect(screen.getByText('ממתין לאישור')).toBeInTheDocument()
  })

  it('clicking rejected card opens dismissal dialog with rejection reason', async () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    mockUseMyProposals.mockReturnValue({ proposals: [rejectedRewardProposal], refetch: vi.fn() })
    renderPage()
    await userEvent.click(screen.getByText('טיול לים'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/יקר מדי/)).toBeInTheDocument()
  })

  it('clicking rejected card without reason shows generic message', async () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    mockUseMyProposals.mockReturnValue({ proposals: [rejectedNoReason], refetch: vi.fn() })
    renderPage()
    await userEvent.click(screen.getByText('קונצרט'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/נדחתה על ידי המנהל/)).toBeInTheDocument()
  })

  it('"אישור" calls dismiss_rejected_proposal RPC with reward type and refetches', async () => {
    const mockRefetchProposals = vi.fn()
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    mockUseMyProposals.mockReturnValue({ proposals: [rejectedRewardProposal], refetch: mockRefetchProposals })
    mockRpc.mockResolvedValue({ error: null })

    renderPage()
    await userEvent.click(screen.getByText('טיול לים'))
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('dismiss_rejected_proposal', {
        p_entity_type: 'reward',
        p_entity_id: 'pr2',
      })
      expect(mockRefetchProposals).toHaveBeenCalled()
    })
  })
})
