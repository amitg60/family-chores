import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/usePendingRedemptions', () => ({
  usePendingRedemptions: vi.fn(() => ({ redemptions: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/usePendingCompletions', () => ({
  usePendingCompletions: vi.fn(() => ({ completions: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/useAdminDashboardStats', () => ({
  useAdminDashboardStats: vi.fn(() => ({
    leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 0, loading: false, error: null,
  })),
}))
vi.mock('../../../hooks/useWeeklyPopulation', () => ({
  useWeeklyPopulation: vi.fn(),
}))

import { useChores } from '../../../hooks/useChores'
import { usePendingRedemptions } from '../../../hooks/usePendingRedemptions'
import { usePendingCompletions } from '../../../hooks/usePendingCompletions'
import { useAdminDashboardStats } from '../../../hooks/useAdminDashboardStats'
import AdminDashboard from '../AdminDashboard'

const mockUseChores = vi.mocked(useChores)
const mockUsePendingRedemptions = vi.mocked(usePendingRedemptions)
const mockUsePendingCompletions = vi.mocked(usePendingCompletions)
const mockUseAdminDashboardStats = vi.mocked(useAdminDashboardStats)

function renderPage() {
  return render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
}

describe('AdminDashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows pending proposals count', () => {
    mockUseChores.mockReturnValue({
      chores: [
        { id: 'c1', status: 'pending_approval' } as any,
        { id: 'c2', status: 'active' } as any,
      ],
      loading: false, error: null, refetch: vi.fn(),
    })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: vi.fn() })
    mockUseAdminDashboardStats.mockReturnValue({ leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 0, loading: false, error: null })
    renderPage()
    expect(screen.getByText('הצעות ממתינות לאישור')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows pending completions count', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({
      completions: [{ id: 'cp1' } as any, { id: 'cp2' } as any, { id: 'cp3' } as any],
      loading: false, error: null, refetch: vi.fn(),
    })
    mockUseAdminDashboardStats.mockReturnValue({ leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 0, loading: false, error: null })
    renderPage()
    expect(screen.getByText('הגשות ממתינות לאישור')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows active trades count', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: vi.fn() })
    mockUseAdminDashboardStats.mockReturnValue({ leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 7, loading: false, error: null })
    renderPage()
    expect(screen.getByText('עסקאות פעילות')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('shows weekly coins total and leaderboard entries', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: vi.fn() })
    mockUseAdminDashboardStats.mockReturnValue({
      leaderboard: [
        { userId: 'u1', name: 'אבי', avatarUrl: null, weeklyEarned: 90 },
        { userId: 'u2', name: 'דנה', avatarUrl: null, weeklyEarned: 60 },
      ],
      totalCoinsThisWeek: 150,
      activeTradesCount: 0,
      loading: false, error: null,
    })
    renderPage()
    expect(screen.getByText(/150/)).toBeInTheDocument()
    expect(screen.getByText('אבי')).toBeInTheDocument()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText(/90/)).toBeInTheDocument()
  })

  it('shows dashes while stats are loading', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: vi.fn() })
    mockUseAdminDashboardStats.mockReturnValue({ leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 0, loading: true, error: null })
    renderPage()
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })
})
