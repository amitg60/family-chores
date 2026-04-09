import { useEffect } from 'react'
import { Outlet, NavLink, Link } from 'react-router-dom'
import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/use-toast'
import type { PlayerAchievement } from '../../types/database'
import { useNotifications } from '../../hooks/useNotifications'
import { useFamily } from '../../hooks/useFamily'
import NotificationBell from '../notifications/NotificationBell'

export default function PlayerLayout() {
  const { profile, signOut } = useAuth()
  const { toast } = useToast()
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()
  const { family } = useFamily()

  useEffect(() => {
    if (!profile?.id) return
    let active = true

    const channel = supabase
      .channel('achievement-announcements')
      .on(
        'postgres_changes' as const,
        { event: 'INSERT', schema: 'public', table: 'player_achievements' },
        async (payload: RealtimePostgresInsertPayload<PlayerAchievement>) => {
          // Own achievements are already toasted by checkAndAwardAchievements in PlayerDashboard
          if (payload.new.user_id === profile.id) return

          const { data: achievement } = await supabase
            .from('achievements')
            .select('icon, title_he')
            .eq('id', payload.new.achievement_id)
            .single()

          const { data: achiever } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', payload.new.user_id)
            .single()

          if (active && achievement && achiever) {
            toast({
              title: `${achievement.icon} הישג משפחתי!`,
              description: `${achiever.name}: ${achievement.title_he}`,
            })
          }
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between">
        <Link to="/player/profile" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <Avatar className="h-8 w-8">
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback>{profile?.name?.[0] ?? 'מ'}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-semibold text-sm">{profile?.name}</span>
            <span className="text-xs text-muted-foreground">
              🪙 {profile?.coin_balance ?? 0} מטבעות
            </span>
          </div>
        </Link>
        {family && (
          <div className="hidden sm:flex items-center gap-2 border-r pr-3 mr-1">
            <Avatar className="h-7 w-7">
              <AvatarImage src={family.avatar_url ?? undefined} />
              <AvatarFallback>{family.name[0]}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-medium">{family.name}</span>
              {family.team_name && (
                <span className="text-xs text-muted-foreground">{family.team_name}</span>
              )}
            </div>
          </div>
        )}
        <nav className="hidden md:flex items-center gap-2">
          <NavLink
            to="/player"
            end
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            הדשבורד שלי
          </NavLink>
          <NavLink
            to="/player/pool"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            בריכה
          </NavLink>
          <NavLink
            to="/player/store"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            החנות
          </NavLink>
          <NavLink
            to="/player/calendar"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            לוח שבועי
          </NavLink>
          <NavLink
            to="/player/feedback"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            משוב
          </NavLink>
          <NavLink
            to="/player/achievements"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            הישגים
          </NavLink>
          <NavLink
            to="/player/profile"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            פרופיל
          </NavLink>
        </nav>
        <div className="flex items-center gap-2">
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            markRead={markRead}
            markAllRead={markAllRead}
          />
          <Button variant="outline" size="sm" onClick={signOut}>
            יציאה
          </Button>
        </div>
      </header>
      <main className="p-4 max-w-4xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
