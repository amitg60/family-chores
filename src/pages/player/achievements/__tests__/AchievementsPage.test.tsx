import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { AchievementWithStatus } from '../../../../hooks/useAchievements'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useAchievements', () => ({
  useAchievements: vi.fn(() => ({
    achievements: [],
    earnedIds: new Set(),
    totalCompletedAllTime: 0,
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', name: 'דנה' } }),
}))

import { useAchievements } from '../../../../hooks/useAchievements'
import AchievementsPage from '../AchievementsPage'

const mockUseAchievements = vi.mocked(useAchievements)

const earnedAchievement: AchievementWithStatus = {
  id: 'ach1',
  key: 'first_chore',
  title_he: 'משימה ראשונה',
  description_he: 'השלמת את המשימה הראשונה שלך!',
  icon: '🏆',
  trigger_type: 'chore_count',
  threshold: 1,
  created_at: '2026-04-01T00:00:00Z',
  earned_at: '2026-04-05T10:00:00Z',
  player_achievement_id: 'pa1',
}

const lockedAchievement: AchievementWithStatus = {
  id: 'ach2',
  key: 'five_chores_week',
  title_he: '5 משימות בשבוע',
  description_he: 'השלמת 5 משימות בשבוע אחד',
  icon: '🔥',
  trigger_type: 'chore_count',
  threshold: 5,
  created_at: '2026-04-01T00:00:00Z',
  earned_at: null,
  player_achievement_id: null,
}

function renderPage() {
  return render(<MemoryRouter><AchievementsPage /></MemoryRouter>)
}

describe('AchievementsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [], earnedIds: new Set(), totalCompletedAllTime: 0,
      loading: true, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows error state', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [], earnedIds: new Set(), totalCompletedAllTime: 0,
      loading: false, error: 'שגיאה', refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאה')
  })

  it('shows earned achievement with icon, title, and earned date', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [earnedAchievement], earnedIds: new Set(['ach1']),
      totalCompletedAllTime: 1, loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('משימה ראשונה')).toBeInTheDocument()
    expect(screen.getByText('🏆')).toBeInTheDocument()
    expect(screen.getByText(/05\.04\.2026|5\.4\.2026/)).toBeInTheDocument()
  })

  it('shows locked achievement with lock indicator', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [lockedAchievement], earnedIds: new Set(),
      totalCompletedAllTime: 0, loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('5 משימות בשבוע')).toBeInTheDocument()
    expect(screen.getByText('🔒 לא הושג עדיין')).toBeInTheDocument()
  })

  it('shows earned count summary', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [earnedAchievement, lockedAchievement], earnedIds: new Set(['ach1']),
      totalCompletedAllTime: 1, loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText(/1.*2/)).toBeInTheDocument()
  })
})
