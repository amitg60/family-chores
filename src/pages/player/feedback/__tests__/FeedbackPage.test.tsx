import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', family_id: 'f1', name: 'דנה' } }),
}))

import FeedbackPage from '../FeedbackPage'

function renderPage() {
  return render(<MemoryRouter><FeedbackPage /></MemoryRouter>)
}

describe('FeedbackPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders category select, star buttons, mood buttons, textarea, and submit', () => {
    renderPage()
    expect(screen.getByRole('combobox', { name: 'קטגוריה' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 כוכבים' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5 כוכבים' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '😊 שמח' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '😤 מתוסכל' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'טקסט חופשי' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שלח משוב' })).toBeInTheDocument()
  })

  it('shows validation error when submitting without star rating', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '😊 שמח' }))
    await userEvent.click(screen.getByRole('button', { name: 'שלח משוב' }))
    expect(screen.getByRole('alert')).toHaveTextContent('אנא בחר דירוג')
  })

  it('shows validation error when submitting without mood', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '3 כוכבים' }))
    await userEvent.click(screen.getByRole('button', { name: 'שלח משוב' }))
    expect(screen.getByRole('alert')).toHaveTextContent('אנא בחר מצב רוח')
  })

  it('inserts feedback and shows success message', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: '4 כוכבים' }))
    await userEvent.click(screen.getByRole('button', { name: '😊 שמח' }))
    await userEvent.click(screen.getByRole('button', { name: 'שלח משוב' }))

    await waitFor(() =>
      expect(screen.getByText('תודה על המשוב!')).toBeInTheDocument()
    )
    expect(mockFrom).toHaveBeenCalledWith('feedback')
  })

  it('shows error message when insert fails', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: '2 כוכבים' }))
    await userEvent.click(screen.getByRole('button', { name: '😐 נייטרלי' }))
    await userEvent.click(screen.getByRole('button', { name: 'שלח משוב' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשליחת המשוב')
    )
  })

  it('toggles area checkboxes', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    renderPage()

    await userEvent.click(screen.getByRole('checkbox', { name: 'משימות' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'חנות' }))

    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert: mockInsert })

    await userEvent.click(screen.getByRole('button', { name: '5 כוכבים' }))
    await userEvent.click(screen.getByRole('button', { name: '😊 שמח' }))
    await userEvent.click(screen.getByRole('button', { name: 'שלח משוב' }))

    await waitFor(() =>
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ areas: expect.arrayContaining(['chores', 'store']) })
      )
    )
  })

  it('resets form after successful submit', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: '3 כוכבים' }))
    await userEvent.click(screen.getByRole('button', { name: '😤 מתוסכל' }))
    await userEvent.click(screen.getByRole('button', { name: 'שלח משוב' }))

    await waitFor(() => screen.getByText('תודה על המשוב!'))

    await userEvent.click(screen.getByRole('button', { name: 'שלח עוד משוב' }))
    expect(screen.getByRole('button', { name: 'שלח משוב' })).toBeInTheDocument()
    expect(screen.queryByText('תודה על המשוב!')).not.toBeInTheDocument()
  })
})
