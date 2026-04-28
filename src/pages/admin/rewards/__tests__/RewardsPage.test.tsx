import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useRewards', () => ({
  useRewards: vi.fn(() => ({ rewards: [], loading: false, error: null, refetch: mockRefetch })),
}))

import { useRewards } from '../../../../hooks/useRewards'
import RewardsPage from '../RewardsPage'

const mockUseRewards = vi.mocked(useRewards)

const activeReward = {
  id: 'r1', family_id: 'f1', title: 'גלידה', description: null,
  coin_cost: 20, type: 'store' as const, status: 'active' as const,
  proposed_by: null, approved_by: null,
  proposal_rejection_reason: null,
  stock: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const pendingReward = {
  ...activeReward, id: 'r2', title: 'סרט קולנוע',
  status: 'pending_approval' as const,
  proposed_by: 'player-1',
}

const limitedReward = {
  ...activeReward, id: 'r3', title: 'פיצה', stock: 3,
}

function renderPage() {
  return render(<MemoryRouter><RewardsPage /></MemoryRouter>)
}

describe('RewardsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading spinner while loading', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: true, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no active rewards', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('אין פרסים פעילים')).toBeInTheDocument()
  })

  it('shows active reward title and coin cost', () => {
    mockUseRewards.mockReturnValue({ rewards: [activeReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('גלידה')).toBeInTheDocument()
    expect(screen.getByText(/20 מטבעות/)).toBeInTheDocument()
  })

  it('shows stock badge for limited-stock reward', () => {
    mockUseRewards.mockReturnValue({ rewards: [limitedReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('מלאי: 3')).toBeInTheDocument()
  })

  it('shows pending proposal section with approve and reject buttons', () => {
    mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('סרט קולנוע')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אשר' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeInTheDocument()
  })

  it('archive calls update with status archived and refetches', async () => {
    mockUseRewards.mockReturnValue({ rewards: [activeReward], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'ארכיון' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'archived' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows error alert when archive fails', async () => {
    mockUseRewards.mockReturnValue({ rewards: [activeReward], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } })
    mockFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: mockEq }) })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'ארכיון' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בארכוב הפרס')
    )
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('approve sets status active and refetches', async () => {
    mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: mockEq }) })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('reject on proposal opens rejection reason dialog, not direct update', async () => {
    mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
    const mockUpdate = vi.fn()
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'דחיית הצעה' })).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejection dialog cancel closes dialog without calling update', async () => {
    mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
    mockFrom.mockReturnValue({ update: vi.fn() })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('rejection dialog confirm without reason calls update with proposal_rejection_reason null', async () => {
    mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
    await userEvent.click(screen.getByRole('button', { name: 'דחה הצעה' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'archived',
        proposal_rejection_reason: null,
      })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('rejection dialog confirm with reason calls update with trimmed reason', async () => {
    mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
    const textarea = screen.getByRole('textbox')
    await userEvent.type(textarea, 'יקר מדי')
    await userEvent.click(screen.getByRole('button', { name: 'דחה הצעה' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'archived',
        proposal_rejection_reason: 'יקר מדי',
      })
    })
  })

  it('shows link to create new reward', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('link', { name: 'פרס חדש' })).toBeInTheDocument()
  })
})
