import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from '../ProtectedRoute'

const mockUseAuth = vi.fn()

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

function renderProtected(
  authState: { session: unknown; profile: unknown; loading: boolean },
  requiredRole?: 'admin' | 'player'
) {
  mockUseAuth.mockReturnValue(authState)
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/player" element={<div>player home</div>} />
        <Route path="/admin" element={<div>admin home</div>} />
        <Route
          path="/protected"
          element={
            <ProtectedRoute requiredRole={requiredRole}>
              <div>protected content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading spinner while auth is loading', () => {
    renderProtected({ session: null, profile: null, loading: true })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('redirects to /login when not authenticated', () => {
    renderProtected({ session: null, profile: null, loading: false })
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('renders children when authenticated without role requirement', () => {
    renderProtected({
      session: { user: { id: '1' } },
      profile: { role: 'player' },
      loading: false,
    })
    expect(screen.getByText('protected content')).toBeInTheDocument()
  })

  it('renders children when authenticated with matching role', () => {
    renderProtected(
      { session: { user: { id: '1' } }, profile: { role: 'admin' }, loading: false },
      'admin'
    )
    expect(screen.getByText('protected content')).toBeInTheDocument()
  })

  it('redirects player away from admin route to /player', () => {
    renderProtected(
      { session: { user: { id: '1' } }, profile: { role: 'player' }, loading: false },
      'admin'
    )
    expect(screen.getByText('player home')).toBeInTheDocument()
  })

  it('redirects admin away from player route to /admin', () => {
    renderProtected(
      { session: { user: { id: '1' } }, profile: { role: 'admin' }, loading: false },
      'player'
    )
    expect(screen.getByText('admin home')).toBeInTheDocument()
  })
})
