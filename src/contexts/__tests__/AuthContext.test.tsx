import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import '../../test/mocks/supabase'
import {
  mockGetSession,
  mockOnAuthStateChange,
  mockSignInWithPassword,
  mockSignOut,
  mockFrom,
} from '../../test/mocks/supabase'
import { AuthProvider, useAuth } from '../AuthContext'

function TestConsumer() {
  const { session, profile, loading } = useAuth()
  if (loading) return <div>loading</div>
  return (
    <div>
      <span data-testid="session">{session ? 'logged-in' : 'logged-out'}</span>
      <span data-testid="profile">{profile?.name ?? 'no-profile'}</span>
    </div>
  )
}

function renderWithAuth() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
  })

  it('starts in loading state', () => {
    mockGetSession.mockReturnValue(new Promise(() => {})) // never resolves
    renderWithAuth()
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('shows logged-out state when no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    renderWithAuth()
    await waitFor(() => {
      expect(screen.getByTestId('session')).toHaveTextContent('logged-out')
    })
  })

  it('fetches profile when session exists', async () => {
    const fakeSession = { user: { id: 'user-123' } }
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } })
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'user-123', name: 'דנה' } }),
    })
    renderWithAuth()
    await waitFor(() => {
      expect(screen.getByTestId('profile')).toHaveTextContent('דנה')
    })
  })

  it('signIn calls supabase signInWithPassword', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockSignInWithPassword.mockResolvedValue({ error: null })

    function SignInConsumer() {
      const { signIn } = useAuth()
      return <button onClick={() => signIn('a@b.com', 'pass')}>sign in</button>
    }

    render(
      <AuthProvider>
        <SignInConsumer />
      </AuthProvider>
    )

    await waitFor(() => screen.getByText('sign in'))
    screen.getByText('sign in').click()

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pass' })
    })
  })

  it('signOut calls supabase signOut', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockSignOut.mockResolvedValue({})

    function SignOutConsumer() {
      const { signOut } = useAuth()
      return <button onClick={signOut}>sign out</button>
    }

    render(
      <AuthProvider>
        <SignOutConsumer />
      </AuthProvider>
    )

    await waitFor(() => screen.getByText('sign out'))
    screen.getByText('sign out').click()

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
    })
  })

  it('useAuth throws when used outside AuthProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<TestConsumer />)).toThrow('useAuth must be used within AuthProvider')
    consoleError.mockRestore()
  })
})
