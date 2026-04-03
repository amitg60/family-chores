import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../test/mocks/supabase'

const mockSignIn = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ signIn: mockSignIn }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import LoginPage from '../LoginPage'

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Hebrew labels', () => {
    renderLogin()
    expect(screen.getByLabelText('אימייל')).toBeInTheDocument()
    expect(screen.getByLabelText('סיסמה')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeInTheDocument()
  })

  it('calls signIn with email and password on submit', async () => {
    mockSignIn.mockResolvedValue({ error: null })
    renderLogin()

    await userEvent.type(screen.getByLabelText('אימייל'), 'parent@family.com')
    await userEvent.type(screen.getByLabelText('סיסמה'), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: 'כניסה' }))

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('parent@family.com', 'secret123')
    })
  })

  it('shows Hebrew error message on failed login', async () => {
    mockSignIn.mockResolvedValue({ error: new Error('Invalid credentials') })
    renderLogin()

    await userEvent.type(screen.getByLabelText('אימייל'), 'x@x.com')
    await userEvent.type(screen.getByLabelText('סיסמה'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'כניסה' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('האימייל או הסיסמה שגויים')
    })
  })

  it('navigates to / after successful login (router handles redirect)', async () => {
    mockSignIn.mockResolvedValue({ error: null })
    renderLogin()

    await userEvent.type(screen.getByLabelText('אימייל'), 'p@p.com')
    await userEvent.type(screen.getByLabelText('סיסמה'), 'pass')
    await userEvent.click(screen.getByRole('button', { name: 'כניסה' }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
    })
  })

  it('disables button while submitting', async () => {
    let resolve: (v: unknown) => void
    mockSignIn.mockReturnValue(new Promise(r => { resolve = r }))
    renderLogin()

    await userEvent.type(screen.getByLabelText('אימייל'), 'p@p.com')
    await userEvent.type(screen.getByLabelText('סיסמה'), 'pass')
    await userEvent.click(screen.getByRole('button', { name: 'כניסה' }))

    expect(screen.getByRole('button', { name: /מתחבר/ })).toBeDisabled()
    resolve!({ error: null })
  })
})
