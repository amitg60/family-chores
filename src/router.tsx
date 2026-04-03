import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import AdminDashboard from './pages/admin/AdminDashboard'
import PlayerDashboard from './pages/player/PlayerDashboard'
import AdminLayout from './components/layout/AdminLayout'
import PlayerLayout from './components/layout/PlayerLayout'

function RootRedirect() {
  const { profile, session, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  return <Navigate to={profile?.role === 'admin' ? '/admin' : '/player'} replace />
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute requiredRole="admin">
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <AdminDashboard /> },
    ],
  },
  {
    path: '/player',
    element: (
      <ProtectedRoute requiredRole="player">
        <PlayerLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <PlayerDashboard /> },
    ],
  },
  {
    path: '/',
    element: <RootRedirect />,
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
])
