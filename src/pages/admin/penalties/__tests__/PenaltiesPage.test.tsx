import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'

const mockWaive = vi.fn().mockResolvedValue({ error: null })
const mockReverse = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn().mockResolvedValue({ error: null })
const mockRefetchOverdue = vi.fn()
const mockRefetchApplied = vi.fn()

vi.mock('../../../../hooks/useOverdueAssignments', () => ({
  useOverdueAssignments: vi.fn(() => ({
    assignments: [],
    loading: false,
    error: null,
    waive: mockWaive,
    refetch: mockRefetchOverdue,
  })),
}))
vi.mock('../../../../hooks/usePenaltyPolicy', () => ({
  usePenaltyPolicy: vi.fn(() => ({
    policy: { overdue_day_deduction: 1, overdue_week_deduction: 5 },
    loading: false,
    error: null,
    update: mockUpdate,
  })),
}))
vi.mock('../../../../hooks/useAppliedPenalties', () => ({
  useAppliedPenalties: vi.fn(() => ({
    penalties: [],
    loading: false,
    error: null,
    reverse: mockReverse,
    refetch: mockRefetchApplied,
  })),
}))

import { useOverdueAssignments } from '../../../../hooks/useOverdueAssignments'
import { usePenaltyPolicy } from '../../../../hooks/usePenaltyPolicy'
import { useAppliedPenalties } from '../../../../hooks/useAppliedPenalties'
import PenaltiesPage from '../PenaltiesPage'

const mockUseOverdue = vi.mocked(useOverdueAssignments)
const mockUsePolicy = vi.mocked(usePenaltyPolicy)
const mockUseApplied = vi.mocked(useAppliedPenalties)

const fakeAssignment = {
  id: 'a1',
  chore_id: 'c1',
  user_id: 'p1',
  calendar_day: 1,
  calendar_slot: 'morning' as const,
  penalty_waived: false,
  chores: { title: 'כלי מטבח', coin_value: 10 },
  profiles: { name: 'דנה', avatar_url: null },
}

const fakePenalty = {
  id: 'pen1',
  chore_assignment_id: 'a1',
  user_id: 'p1',
  coin_deduction: 1,
  reason: 'overdue',
  waived_by: null,
  waived_at: null,
  applied_at: '2026-04-19T23:59:00Z',
  batch_id: 'batch-1',
  chore_assignments: { chore_id: 'c1', chores: { title: 'כלי מטבח' } },
  profiles: { name: 'דנה', avatar_url: null },
}

function renderPage() {
  return render(<MemoryRouter><PenaltiesPage /></MemoryRouter>)
}

describe('PenaltiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePolicy.mockReturnValue({
      policy: { overdue_day_deduction: 1, overdue_week_deduction: 5, id: 'pol1', family_id: 'f1', per_chore_overrides: null, updated_by: null, updated_at: '' },
      loading: false, error: null, update: mockUpdate,
    })
    mockUseOverdue.mockReturnValue({ assignments: [], loading: false, error: null, waive: mockWaive, refetch: mockRefetchOverdue })
    mockUseApplied.mockReturnValue({ penalties: [], loading: false, error: null, reverse: mockReverse, refetch: mockRefetchApplied })
  })

  it('renders page heading', () => {
    renderPage()
    expect(screen.getByText('ניהול הפסדים')).toBeInTheDocument()
  })

  it('shows policy deduction values', () => {
    renderPage()
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
  })

  it('shows empty state when no overdue assignments', () => {
    renderPage()
    expect(screen.getByText('אין משימות באיחור')).toBeInTheDocument()
  })

  it('shows overdue assignment with player name and chore title', () => {
    mockUseOverdue.mockReturnValue({ assignments: [fakeAssignment], loading: false, error: null, waive: mockWaive, refetch: mockRefetchOverdue })
    renderPage()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
  })

  it('waive button calls waive with assignment id', async () => {
    mockUseOverdue.mockReturnValue({ assignments: [fakeAssignment], loading: false, error: null, waive: mockWaive, refetch: mockRefetchOverdue })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /ויתור/i }))
    expect(mockWaive).toHaveBeenCalledWith('a1')
  })

  it('shows applied penalties section', () => {
    mockUseApplied.mockReturnValue({ penalties: [fakePenalty], loading: false, error: null, reverse: mockReverse, refetch: mockRefetchApplied })
    renderPage()
    expect(screen.getByText('הפסדים שהוחלו')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /בטל הפסד/i })).toBeInTheDocument()
  })

  it('reverse button calls reverse with penalty id', async () => {
    mockUseApplied.mockReturnValue({ penalties: [fakePenalty], loading: false, error: null, reverse: mockReverse, refetch: mockRefetchApplied })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /בטל הפסד/i }))
    expect(mockReverse).toHaveBeenCalledWith('pen1')
  })

  it('save policy button calls update with new values', async () => {
    renderPage()
    const inputs = screen.getAllByRole('spinbutton')
    await userEvent.clear(inputs[0])
    await userEvent.type(inputs[0], '2')
    await userEvent.click(screen.getByRole('button', { name: /שמור/i }))
    expect(mockUpdate).toHaveBeenCalled()
  })
})
