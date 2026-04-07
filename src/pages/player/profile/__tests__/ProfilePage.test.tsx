import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { AchievementWithStatus } from '../../../../hooks/useAchievements'
import type { CoinTransaction } from '../../../../types/database'

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'u1',
      name: 'דנה',
      avatar_url: null,
      coin_balance: 50,
      trust_level: 3,
      family_id: 'f1',
      role: 'player',
      created_at: '',
      updated_at: '',
    },
  }),
}))

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useAchievements', () => ({
  useAchievements: vi.fn(() => ({
    achievements: [{ id: 'ach1', icon: '⭐', name: 'First', description: '', condition_type: 'chores_completed', condition_value: 1 }] as AchievementWithStatus[],
    earnedIds: new Set(['ach1']),
    totalCompletedAllTime: 1,
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))

vi.mock('../../../../hooks/useCoinTransactions', () => ({
  useCoinTransactions: vi.fn(() => ({
    transactions: [] as CoinTransaction[],
    totalEarned: 100,
    totalSpent: 30,
    loading: false,
    error: null,
  })),
}))

import { useCoinTransactions } from '../../../../hooks/useCoinTransactions'
import { useAchievements } from '../../../../hooks/useAchievements'
const mockUseAchievements = vi.mocked(useAchievements)
import ProfilePage from '../ProfilePage'

const mockUseCoinTransactions = vi.mocked(useCoinTransactions)

const fakeTx: CoinTransaction = {
  id: 'tx1',
  user_id: 'u1',
  family_id: 'f1',
  amount: 10,
  reason: 'chore_completed',
  related_entity_id: null,
  created_at: '2026-04-05T10:00:00Z',
}

const negTx: CoinTransaction = {
  id: 'tx2',
  user_id: 'u1',
  family_id: 'f1',
  amount: -5,
  reason: 'reward_redeemed',
  related_entity_id: null,
  created_at: '2026-04-04T10:00:00Z',
}

function renderPage() {
  return render(<MemoryRouter><ProfilePage /></MemoryRouter>)
}

describe('ProfilePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state', () => {
    mockUseCoinTransactions.mockReturnValue({
      transactions: [], totalEarned: 0, totalSpent: 0, loading: true, error: null,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows player name, coin balance, and trust level bar', () => {
    renderPage()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText(/50/)).toBeInTheDocument()
    expect(screen.getByText(/3.*5|3 \/ 5/)).toBeInTheDocument()
  })

  it('shows coin summary stats on coins tab (default)', () => {
    mockUseCoinTransactions.mockReturnValue({
      transactions: [fakeTx, negTx], totalEarned: 100, totalSpent: 30, loading: false, error: null,
    })
    renderPage()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('משימה הושלמה')).toBeInTheDocument()
    expect(screen.getByText('פדיון פרס')).toBeInTheDocument()
  })

  it('shows achievements summary when achievements tab clicked', () => {
    renderPage()
    fireEvent.click(screen.getByText(/הישגים/))
    expect(screen.getByText(/1.*7|1 מתוך 7/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ראה את כל ההישגים/ })).toBeInTheDocument()
  })

  it('shows locked trade placeholder when trades tab clicked', () => {
    renderPage()
    fireEvent.click(screen.getByText(/מסחר/))
    expect(screen.getByText('שוק ההחלפות')).toBeInTheDocument()
    expect(screen.getByText(/בקרוב/)).toBeInTheDocument()
  })

  it('shows positive amounts in green and negative in red', () => {
    mockUseCoinTransactions.mockReturnValue({
      transactions: [fakeTx, negTx], totalEarned: 100, totalSpent: 30, loading: false, error: null,
    })
    renderPage()
    const positive = screen.getByText('+10')
    const negative = screen.getByText('−5')
    expect(positive).toHaveClass('text-green-600')
    expect(negative).toHaveClass('text-destructive')
  })

  it('shows error state on coins tab', () => {
    mockUseCoinTransactions.mockReturnValue({
      transactions: [], totalEarned: 0, totalSpent: 0, loading: false, error: 'שגיאה בטעינה',
    })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בטעינה')
  })
})
