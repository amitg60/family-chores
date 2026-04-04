import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockRpc } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useRewards', () => ({
  useRewards: vi.fn(() => ({ rewards: [], loading: false, error: null, refetch: mockRefetch })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1', coin_balance: 50 } }),
}))

import { useRewards } from '../../../../hooks/useRewards'
import RewardStorePage from '../RewardStorePage'

const mockUseRewards = vi.mocked(useRewards)

const fakeReward = {
  id: 'r1', family_id: 'f1', title: 'גלידה', description: 'גלידת וניל',
  coin_cost: 20, type: 'store' as const, status: 'active' as const,
  proposed_by: null, approved_by: null, stock: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const expensiveReward = { ...fakeReward, id: 'r2', title: 'נסיעה לפארק', coin_cost: 100 }

function renderPage() {
  return render(<MemoryRouter><RewardStorePage /></MemoryRouter>)
}

describe('RewardStorePage', () => {
  beforeEach(() => vi.clearAllMocks())

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
})
