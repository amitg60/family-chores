import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

interface ProtectedRouteProps {
  children: ReactNode
  requiredRole?: 'admin' | 'player'
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div role="status" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (requiredRole && profile?.role !== requiredRole) {
    return <Navigate to={profile?.role === 'admin' ? '/admin' : '/player'} replace />
  }

  return <>{children}</>
}
