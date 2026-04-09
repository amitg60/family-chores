import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import JoinPage from './pages/JoinPage'
import AdminDashboard from './pages/admin/AdminDashboard'
import ChoresPage from './pages/admin/chores/ChoresPage'
import ChoreFormPage from './pages/admin/chores/ChoreFormPage'
import CompletionsPage from './pages/admin/completions/CompletionsPage'
import RewardsPage from './pages/admin/rewards/RewardsPage'
import RewardFormPage from './pages/admin/rewards/RewardFormPage'
import RedemptionsPage from './pages/admin/rewards/RedemptionsPage'
import PlayerDashboard from './pages/player/PlayerDashboard'
import ChorePoolPage from './pages/player/chores/ChorePoolPage'
import CompletionPage from './pages/player/chores/CompletionPage'
import RewardStorePage from './pages/player/store/RewardStorePage'
import AdminLayout from './components/layout/AdminLayout'
import PlayerLayout from './components/layout/PlayerLayout'
import PlayerCalendarPage from './pages/player/calendar/WeeklyCalendarPage'
import AdminCalendarPage from './pages/admin/calendar/WeeklyCalendarPage'
import FeedbackPage from './pages/player/feedback/FeedbackPage'
import FeedbackDashboard from './pages/admin/feedback/FeedbackDashboard'
import PlayersPage from './pages/admin/players/PlayersPage'
import AchievementsPage from './pages/player/achievements/AchievementsPage'
import ProfilePage from './pages/player/profile/ProfilePage'

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
    path: '/signup',
    element: <SignupPage />,
  },
  {
    path: '/join',
    element: <JoinPage />,
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
      { path: 'chores', element: <ChoresPage /> },
      { path: 'chores/new', element: <ChoreFormPage /> },
      { path: 'chores/:id/edit', element: <ChoreFormPage /> },
      { path: 'completions', element: <CompletionsPage /> },
      { path: 'rewards', element: <RewardsPage /> },
      { path: 'rewards/new', element: <RewardFormPage /> },
      { path: 'rewards/:id/edit', element: <RewardFormPage /> },
      { path: 'redemptions', element: <RedemptionsPage /> },
      { path: 'calendar', element: <AdminCalendarPage /> },
      { path: 'feedback', element: <FeedbackDashboard /> },
      { path: 'players', element: <PlayersPage /> },
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
      { path: 'pool', element: <ChorePoolPage /> },
      { path: 'chores/:assignmentId/complete', element: <CompletionPage /> },
      { path: 'store', element: <RewardStorePage /> },
      { path: 'calendar', element: <PlayerCalendarPage /> },
      { path: 'feedback', element: <FeedbackPage /> },
      { path: 'achievements', element: <AchievementsPage /> },
      { path: 'profile', element: <ProfilePage /> },
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
