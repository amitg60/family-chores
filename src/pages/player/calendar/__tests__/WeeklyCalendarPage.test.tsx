// src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'
import type { AssignmentWithDetails } from '../../../../hooks/useCalendarAssignments'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useCalendarAssignments', () => ({
  useCalendarAssignments: vi.fn(() => ({
    assignments: [],
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', name: 'דנה' } }),
}))

import { useCalendarAssignments } from '../../../../hooks/useCalendarAssignments'
import WeeklyCalendarPage from '../WeeklyCalendarPage'

const mockUseCalendarAssignments = vi.mocked(useCalendarAssignments)

const ownPinned: AssignmentWithDetails = {
  id: 'a1', chore_id: 'c1', user_id: 'u1',
  week_start: '2026-03-29', calendar_day: 1, calendar_slot: 'morning',
  reminder_enabled: false, status: 'pending', archived: false,
  created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z',
  chores: { title: 'כלים', coin_value: 10 },
  profiles: { name: 'דנה', avatar_url: null },
}

const ownUnscheduled: AssignmentWithDetails = {
  ...ownPinned, id: 'a2', calendar_day: null, calendar_slot: null,
  chores: { title: 'שקים', coin_value: 5 },
}

const otherPinned: AssignmentWithDetails = {
  ...ownPinned, id: 'a3', user_id: 'u2', calendar_day: 2, calendar_slot: 'afternoon',
  chores: { title: 'אבק', coin_value: 8 },
  profiles: { name: 'תום', avatar_url: null },
}

function renderPage() {
  return render(<MemoryRouter><WeeklyCalendarPage /></MemoryRouter>)
}

describe('Player WeeklyCalendarPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: true, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows own unscheduled assignments in "ללא סידור" section with pin button', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('ללא סידור')).toBeInTheDocument()
    expect(screen.getByText('שקים')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'קבע זמן' })).toBeInTheDocument()
  })

  it('opens pin dialog when "קבע זמן" is clicked', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'קבע זמן' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'קבע זמן למשימה' })).toBeInTheDocument()
  })

  it('submits pin with selected day and slot, then calls refetch', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    const mockUpdateFn = vi.fn().mockReturnThis()
    const mockEqFn = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: mockUpdateFn, eq: mockEqFn })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'קבע זמן' }))
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('chore_assignments')
      expect(mockRefetch).toHaveBeenCalled()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows error in dialog when pin save fails', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'קבע זמן' }))
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בקביעת הזמן')
    )
  })

  it('cancels pin dialog without saving', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'קבע זמן' }))
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }))

    expect(mockFrom).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"הסר" button unpins own assignment', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownPinned], loading: false, error: null, refetch: mockRefetch,
    })
    const mockUpdateFn = vi.fn().mockReturnThis()
    const mockEqFn = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: mockUpdateFn, eq: mockEqFn })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'הסר' }))

    await waitFor(() => {
      expect(mockUpdateFn).toHaveBeenCalledWith({ calendar_day: null, calendar_slot: null })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('reminder checkbox toggles reminder_enabled on own assignment', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    const mockUpdateFn = vi.fn().mockReturnThis()
    const mockEqFn = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: mockUpdateFn, eq: mockEqFn })
    renderPage()

    // ownUnscheduled.reminder_enabled = false → toggling sets to true
    await userEvent.click(screen.getByRole('checkbox', { name: 'תזכורת' }))

    await waitFor(() => {
      expect(mockUpdateFn).toHaveBeenCalledWith({ reminder_enabled: true })
    })
  })

  it('does not show pin/unpin/reminder controls for other players\' assignments', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [otherPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('אבק')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'קבע זמן' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הסר' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'תזכורת' })).not.toBeInTheDocument()
  })
})
