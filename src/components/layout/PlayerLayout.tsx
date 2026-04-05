import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'

export default function PlayerLayout() {
  const { profile, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
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
        </div>
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
        </nav>
        <Button variant="outline" size="sm" onClick={signOut}>
          יציאה
        </Button>
      </header>
      <main className="p-4 max-w-4xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
