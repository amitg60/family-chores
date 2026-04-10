import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFamily } from '../../hooks/useFamily'
import { useAliasVote } from '../../hooks/useAliasVote'
import { useFamilyMembers } from '../../hooks/useFamilyMembers'
import { Button } from '../ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import AliasVoteBanner from '../shared/AliasVoteBanner'
import {
  LayoutDashboard,
  CheckSquare,
  ClipboardCheck,
  Gift,
  ShoppingBag,
  CalendarDays,
  MessageSquare,
  Users,
} from 'lucide-react'

const adminNavItems = [
  { to: '/admin', label: 'דשבורד', icon: LayoutDashboard, end: true },
  { to: '/admin/chores', label: 'משימות', icon: CheckSquare },
  { to: '/admin/completions', label: 'הגשות', icon: ClipboardCheck },
  { to: '/admin/rewards', label: 'פרסים', icon: Gift },
  { to: '/admin/redemptions', label: 'מימושים', icon: ShoppingBag },
  { to: '/admin/calendar', label: 'לוח שבועי', icon: CalendarDays },
  { to: '/admin/feedback', label: 'משוב', icon: MessageSquare },
  { to: '/admin/players', label: 'שחקנים', icon: Users },
]

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const { family } = useFamily()
  const { proposal, votes, castVote } = useAliasVote()
  const { members } = useFamilyMembers()

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback>{profile?.name?.[0] ?? 'א'}</AvatarFallback>
          </Avatar>
          <span className="font-semibold">{profile?.name}</span>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">מנהל</span>
          {family && (
            <div className="flex items-center gap-2 border-r pr-3 mr-1">
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
        </div>
        <nav className="hidden md:flex items-center gap-2">
          {adminNavItems.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <Button variant="outline" size="sm" onClick={signOut}>
          יציאה
        </Button>
      </header>
      <main className="p-4 max-w-7xl mx-auto pb-20 md:pb-4">
        {proposal && profile && (
          <AliasVoteBanner
            proposal={proposal}
            votes={votes}
            totalMembers={members.length}
            currentUserId={profile.id}
            castVote={castVote}
          />
        )}
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t z-50 flex overflow-x-auto" dir="rtl">
        {adminNavItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 px-3 py-2 min-w-[4rem] flex-1 text-xs font-medium transition-colors shrink-0 ${
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
