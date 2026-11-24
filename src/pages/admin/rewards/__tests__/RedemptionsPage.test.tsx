import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/usePendingRedemptions', () => ({
  usePendingRedemptions: vi.fn(() => ({
    redemptions: [],
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))

import { usePendingRedemptions } from '../../../../hooks/usePendingRedemptions'
import RedemptionsPage from '../RedemptionsPage'

const mockUsePendingRedemptions = vi.mocked(usePendingRedemptions)

const fakeRedemption = {
  id: 'red1',
  reward_id: 'r1',
  redeemed_by: 'p1',
  coin_cost_at_time: 20,
  status: 'pending' as const,
  redeemed_at: '2026-04-04T10:00:00Z',
  resolved_at: null,
  rewards: { title: 'גלידה', coin_cost: 20 },
  profiles: { name: 'דנה' },
}

function renderPage() {
  return render(<MemoryRouter><RedemptionsPage /></MemoryRouter>)
}

describe('RedemptionsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading spinner while loading', () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: true, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no pending redemptions', () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('אין בקשות מימוש ממתינות.')).toBeInTheDocument()
  })

  it('shows redemption with reward title, player name, and cost', () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('גלידה')).toBeInTheDocument()
    expect(screen.getByText(/דנה/)).toBeInTheDocument()
    expect(screen.getByText(/20 מטבעות/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אשר' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeInTheDocument()
  })

  it('grant calls direct update and refetches', async () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    const mockSelect = vi.fn().mockResolvedValue({ data: [{ id: 'red1' }], error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: mockSelect }) })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'granted' })
      )
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows error when grant fails', async () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    const mockSelect = vi.fn().mockResolvedValue({ data: null, error: { message: 'denied' } })
    mockFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: mockSelect }) }) })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה במתן הפרס')
    )
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('shows already-handled when grant matches no pending row', async () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    const mockSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    mockFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: mockSelect }) }) })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('הבקשה כבר טופלה')
    )
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('decline calls decline_redemption RPC and refetches', async () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('decline_redemption', { p_redemption_id: 'red1' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows error when decline fails', async () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'denied' } })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בדחיית הבקשה')
    )
    expect(mockRefetch).not.toHaveBeenCalled()
  })
})
