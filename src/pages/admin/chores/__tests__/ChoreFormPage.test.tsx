import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'
import { useFamilyMembers } from '../../../../hooks/useFamilyMembers'

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
  recurrence_type: 'none', status: 'active',
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
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
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
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
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
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnValue(new Promise(r => { resolve = r })),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם המשימה'), 'כלי מטבח')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    expect(screen.getByRole('button', { name: /שומר/ })).toBeDisabled()
    resolve!({ data: { id: 'new-id' }, error: null })
  })

  it('shows daily schedule grid when daily recurrence is selected', async () => {
    renderCreate()
    const recurrenceSelect = screen.getByRole('combobox', { name: 'סוג חזרה' })
    await userEvent.click(recurrenceSelect)
    await waitFor(() => screen.getByRole('option', { name: 'יומי' }))
    await userEvent.click(screen.getByRole('option', { name: 'יומי' }))
    await waitFor(() => expect(screen.getByText('ראשון')).toBeInTheDocument())
    expect(screen.getByText('שבת')).toBeInTheDocument()
  })

  it('shows member checkboxes when weekly recurrence is selected', async () => {
    renderCreate()
    const recurrenceSelect = screen.getByRole('combobox', { name: 'סוג חזרה' })
    await userEvent.click(recurrenceSelect)
    await waitFor(() => screen.getByRole('option', { name: 'שבועי' }))
    await userEvent.click(screen.getByRole('option', { name: 'שבועי' }))
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes.length).toBeGreaterThan(0)
    })
  })
})

describe('ChoreFormPage — edit mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pre-fills form with existing chore data', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingChore, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      })
    renderEdit('c1')

    await waitFor(() =>
      expect((screen.getByLabelText('שם המשימה') as HTMLInputElement).value).toBe('כלי מטבח')
    )
    expect((screen.getByLabelText('תיאור') as HTMLTextAreaElement).value).toBe('לשטוף כלים')
  })

  it('shows error when edit-mode fetch fails', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      })
    renderEdit('c1')

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    )
  })

  it('updates chore on submit and navigates to /admin/chores', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingChore, error: null }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
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

describe('ChoreFormPage — daily schedule multi-player', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows checkboxes per day member when daily recurrence selected', async () => {
    renderCreate()
    await userEvent.click(screen.getByRole('combobox', { name: 'סוג חזרה' }))
    await userEvent.click(screen.getByRole('option', { name: 'יומי' }))
    expect(screen.getByRole('checkbox', { name: 'ראשון — דנה' })).toBeInTheDocument()
  })

  it('allows multiple players to be checked for the same day', async () => {
    vi.mocked(useFamilyMembers).mockReturnValue({
      members: [
        { id: 'p1', name: 'דנה', role: 'player' as const, family_id: 'f1', avatar_url: null, trust_level: 1, coin_balance: 0, created_at: '', updated_at: '' },
        { id: 'p2', name: 'יוסי', role: 'player' as const, family_id: 'f1', avatar_url: null, trust_level: 1, coin_balance: 0, created_at: '', updated_at: '' },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    renderCreate()
    await userEvent.click(screen.getByRole('combobox', { name: 'סוג חזרה' }))
    await userEvent.click(screen.getByRole('option', { name: 'יומי' }))

    await userEvent.click(screen.getByRole('checkbox', { name: 'ראשון — דנה' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'ראשון — יוסי' }))

    expect(screen.getByRole('checkbox', { name: 'ראשון — דנה' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'ראשון — יוסי' })).toBeChecked()
  })
})
