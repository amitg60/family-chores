import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Notification } from '../../../types/database'
import NotificationBell from '../NotificationBell'

const mockMarkRead = vi.fn()
const mockMarkAllRead = vi.fn()

const n1: Notification = {
  id: 'n1', user_id: 'u1', family_id: 'f1',
  type: 'chore_assigned', title_he: 'הוקצתה לך משימה חדשה',
  body_he: 'ניקוי חדר', related_entity_id: null, read: false,
  created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 mins ago
}
const n2: Notification = {
  id: 'n2', user_id: 'u1', family_id: 'f1',
  type: 'achievement_earned', title_he: 'זכית בהישג חדש!',
  body_he: '🏆 משימה ראשונה', related_entity_id: null, read: false,
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hrs ago
}

function renderBell(notifications: Notification[], unreadCount: number) {
  return render(
    <NotificationBell
      notifications={notifications}
      unreadCount={unreadCount}
      markRead={mockMarkRead}
      markAllRead={mockMarkAllRead}
    />
  )
}

describe('NotificationBell', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows badge with unreadCount when > 0', () => {
    renderBell([n1, n2], 2)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('hides badge when unreadCount is 0', () => {
    renderBell([], 0)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('opens popover and shows notifications when bell is clicked', () => {
    renderBell([n1, n2], 2)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    expect(screen.getByText('התראות')).toBeInTheDocument()
    expect(screen.getByText('הוקצתה לך משימה חדשה')).toBeInTheDocument()
    expect(screen.getByText('ניקוי חדר')).toBeInTheDocument()
    expect(screen.getByText('זכית בהישג חדש!')).toBeInTheDocument()
    expect(screen.getByText(/לפני 5 דקות/)).toBeInTheDocument()
  })

  it('calls markRead with notification id when dismiss button clicked', () => {
    renderBell([n1], 1)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    fireEvent.click(screen.getByRole('button', { name: 'סגור התראה' }))
    expect(mockMarkRead).toHaveBeenCalledWith('n1')
  })

  it('calls markAllRead when "סמן הכל כנקרא" is clicked', () => {
    renderBell([n1, n2], 2)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    fireEvent.click(screen.getByRole('button', { name: 'סמן הכל כנקרא' }))
    expect(mockMarkAllRead).toHaveBeenCalled()
  })

  it('disables "סמן הכל כנקרא" when notifications list is empty', () => {
    renderBell([], 0)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    expect(screen.getByRole('button', { name: 'סמן הכל כנקרא' })).toBeDisabled()
  })

  it('shows empty state when no notifications', () => {
    renderBell([], 0)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    expect(screen.getByText('אין התראות חדשות')).toBeInTheDocument()
  })
})
