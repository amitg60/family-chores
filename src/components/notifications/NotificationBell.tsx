import { Bell, X } from 'lucide-react'
import { Button } from '../ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover'
import type { Notification } from '../../types/database'

interface NotificationBellProps {
  notifications: Notification[]
  unreadCount: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'עכשיו'
  if (minutes === 1) return 'לפני דקה'
  if (minutes < 60) return `לפני ${minutes} דקות`
  if (hours === 1) return 'לפני שעה'
  if (hours < 24) return `לפני ${hours} שעות`
  if (days === 1) return 'אתמול'
  return `לפני ${days} ימים`
}

export default function NotificationBell({
  notifications,
  unreadCount,
  markRead,
  markAllRead,
}: NotificationBellProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="פתח התראות"
          className="relative"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" dir="rtl">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="font-semibold text-sm">התראות</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={markAllRead}
            disabled={notifications.length === 0}
          >
            סמן הכל כנקרא
          </Button>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-6">
              אין התראות חדשות
            </p>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className="flex items-start gap-2 px-3 py-2 border-b last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{n.title_he}</p>
                  <p className="text-xs text-muted-foreground">{n.body_he}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatRelativeTime(n.created_at)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0 mt-0.5"
                  onClick={() => markRead(n.id)}
                  aria-label="סגור התראה"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
