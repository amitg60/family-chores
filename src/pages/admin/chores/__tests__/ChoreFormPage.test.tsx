import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../hooks/useFamilyMembers', () => ({
  useFamilyMembers: vi.fn(() => ({
    members: [{ id: 'p1', name: 'דנה', role: 'player' }],
    loading: false,
    error: null,
  })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', family_id: 'f1' } }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import ChoreFormPage from '../ChoreFormPage'

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/admin/chores/new']}>
      <Routes>
        <Route path="/admin/chores/new" element={<ChoreFormPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderEdit(id = 'c1') {
  return render(
    <MemoryRouter initialEntries={[`/admin/chores/${id}/edit`]}>
      <Routes>
        <Route path="/admin/chores/:id/edit" element={<ChoreFormPage />} />
      </Routes>
    </MemoryRouter>
  )
}

const existingChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', description: 'לשטוף כלים',
  coin_value: 10, difficulty: 'easy', assigned_to: null,
  is_recurring: false, status: 'active',
  proposed_by: null, approved_by: null, due_date: null,
  last_traded_price: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

describe('ChoreFormPage — create mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders all required form fields with Hebrew labels', () => {
    renderCreate()
    expect(screen.getByLabelText('שם המשימה')).toBeInTheDocument()
    expect(screen.getByLabelText('תיאור')).toBeInTheDocument()
    expect(screen.getByLabelText('ערך במטבעות')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שמור' })).toBeInTheDocument()
  })

  it('creates a chore on submit and navigates to /admin/chores', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם המשימה'), 'כלי מטבח')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/chores'))
  })

  it('shows Hebrew error message when insert fails', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם המשימה'), 'כלי מטבח')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשמירת המשימה')
    )
  })

  it('disables submit button while saving', async () => {
    let resolve: (v: unknown) => void
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue(new Promise(r => { resolve = r })),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם המשימה'), 'כלי מטבח')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    expect(screen.getByRole('button', { name: /שומר/ })).toBeDisabled()
    resolve!({ error: null })
  })
})

describe('ChoreFormPage — edit mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pre-fills form with existing chore data', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: existingChore, error: null }),
    })
    renderEdit('c1')

    await waitFor(() =>
      expect((screen.getByLabelText('שם המשימה') as HTMLInputElement).value).toBe('כלי מטבח')
    )
    expect((screen.getByLabelText('תיאור') as HTMLTextAreaElement).value).toBe('לשטוף כלים')
  })

  it('updates chore on submit and navigates to /admin/chores', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingChore, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
    renderEdit('c1')

    await waitFor(() =>
      expect((screen.getByLabelText('שם המשימה') as HTMLInputElement).value).toBe('כלי מטבח')
    )

    await userEvent.clear(screen.getByLabelText('שם המשימה'))
    await userEvent.type(screen.getByLabelText('שם המשימה'), 'כיבוי אורות')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/chores'))
  })
})
