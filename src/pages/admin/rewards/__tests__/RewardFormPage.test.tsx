import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', family_id: 'f1' } }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import RewardFormPage from '../RewardFormPage'

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/admin/rewards/new']}>
      <Routes>
        <Route path="/admin/rewards/new" element={<RewardFormPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderEdit(id = 'r1') {
  return render(
    <MemoryRouter initialEntries={[`/admin/rewards/${id}/edit`]}>
      <Routes>
        <Route path="/admin/rewards/:id/edit" element={<RewardFormPage />} />
      </Routes>
    </MemoryRouter>
  )
}

const existingReward = {
  id: 'r1', family_id: 'f1', title: 'גלידה', description: 'גלידת וניל',
  coin_cost: 20, type: 'store', status: 'active',
  proposed_by: null, approved_by: null, stock: 5,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

describe('RewardFormPage — create mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders all form fields with Hebrew labels', () => {
    renderCreate()
    expect(screen.getByLabelText('שם הפרס')).toBeInTheDocument()
    expect(screen.getByLabelText('תיאור')).toBeInTheDocument()
    expect(screen.getByLabelText('עלות במטבעות')).toBeInTheDocument()
    expect(screen.getByLabelText('מלאי (ריק = ללא הגבלה)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שמור' })).toBeInTheDocument()
  })

  it('creates a reward on submit and navigates to /admin/rewards', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם הפרס'), 'גלידה')
    await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
    await userEvent.type(screen.getByLabelText('עלות במטבעות'), '20')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/rewards'))
  })

  it('shows Hebrew error message when insert fails', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם הפרס'), 'גלידה')
    await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
    await userEvent.type(screen.getByLabelText('עלות במטבעות'), '20')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשמירת הפרס')
    )
  })

  it('disables submit button while saving', async () => {
    let resolve: (v: unknown) => void
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue(new Promise(r => { resolve = r })),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם הפרס'), 'גלידה')
    await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
    await userEvent.type(screen.getByLabelText('עלות במטבעות'), '20')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    expect(screen.getByRole('button', { name: /שומר/ })).toBeDisabled()
    resolve!({ error: null })
  })
})

describe('RewardFormPage — edit mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pre-fills form with existing reward data', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: existingReward, error: null }),
    })
    renderEdit('r1')

    await waitFor(() =>
      expect((screen.getByLabelText('שם הפרס') as HTMLInputElement).value).toBe('גלידה')
    )
    expect((screen.getByLabelText('תיאור') as HTMLTextAreaElement).value).toBe('גלידת וניל')
    expect((screen.getByLabelText('מלאי (ריק = ללא הגבלה)') as HTMLInputElement).value).toBe('5')
  })

  it('shows error when edit-mode fetch fails', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    })
    renderEdit('r1')

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    )
  })

  it('updates reward on submit and navigates to /admin/rewards', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingReward, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
    renderEdit('r1')

    await waitFor(() =>
      expect((screen.getByLabelText('שם הפרס') as HTMLInputElement).value).toBe('גלידה')
    )

    await userEvent.clear(screen.getByLabelText('שם הפרס'))
    await userEvent.type(screen.getByLabelText('שם הפרס'), 'שוקולד')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/rewards'))
  })
})
