import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { mockResetPasswordForEmail, mockUpdateUser } from '../../test/mocks/supabase'

const mockNavigate = vi.fn()
const authState = { session: null as object | null, loading: false }

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => authState,
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import ForgotPasswordPage from '../ForgotPasswordPage'
import ResetPasswordPage from '../ResetPasswordPage'

const renderIn = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('ForgotPasswordPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a reset email that returns to /reset-password', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null })
    renderIn(<ForgotPasswordPage />)
    await userEvent.type(screen.getByLabelText('אימייל'), 'mom@family.com')
    await userEvent.click(screen.getByRole('button', { name: 'שלחו לי קישור' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('נשלח אליו קישור'))
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('mom@family.com', {
      redirectTo: `${window.location.origin}/reset-password`,
    })
  })

  it('shows an error when sending fails', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: { message: 'rate limited' } })
    renderIn(<ForgotPasswordPage />)
    await userEvent.type(screen.getByLabelText('אימייל'), 'mom@family.com')
    await userEvent.click(screen.getByRole('button', { name: 'שלחו לי קישור' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שליחת המייל נכשלה'))
  })
})

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.session = { user: { id: 'u1' } }
    authState.loading = false
  })

  it('shows invalid-link message when there is no session', () => {
    authState.session = null
    renderIn(<ResetPasswordPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('הקישור לא תקין')
    expect(screen.getByRole('link', { name: 'בקשו קישור חדש' })).toHaveAttribute('href', '/forgot-password')
  })

  it('rejects mismatched passwords without calling Supabase', async () => {
    renderIn(<ResetPasswordPage />)
    await userEvent.type(screen.getByLabelText('סיסמה חדשה'), 'secret123')
    await userEvent.type(screen.getByLabelText('אימות סיסמה'), 'secret124')
    await userEvent.click(screen.getByRole('button', { name: 'שמירת סיסמה' }))

    expect(screen.getByRole('alert')).toHaveTextContent('הסיסמאות לא תואמות')
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('saves the new password and goes home', async () => {
    mockUpdateUser.mockResolvedValue({ error: null })
    renderIn(<ResetPasswordPage />)
    await userEvent.type(screen.getByLabelText('סיסמה חדשה'), 'secret123')
    await userEvent.type(screen.getByLabelText('אימות סיסמה'), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: 'שמירת סיסמה' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'secret123' })
  })

  it('shows an error when Supabase rejects the update', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'expired' } })
    renderIn(<ResetPasswordPage />)
    await userEvent.type(screen.getByLabelText('סיסמה חדשה'), 'secret123')
    await userEvent.type(screen.getByLabelText('אימות סיסמה'), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: 'שמירת סיסמה' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('עדכון הסיסמה נכשל'))
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
