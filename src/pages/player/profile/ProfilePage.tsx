import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useAchievements } from '../../../hooks/useAchievements'
import { useCoinTransactions } from '../../../hooks/useCoinTransactions'
import { useFamily } from '../../../hooks/useFamily'
import FamilyAvatarUpload from '../../../components/shared/FamilyAvatarUpload'
import AliasProposalDialog from '../../../components/shared/AliasProposalDialog'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { supabase } from '../../../lib/supabase'
import type { CoinReason } from '../../../types/database'

const TOTAL_ACHIEVEMENTS = 7

const REASON_LABEL: Record<CoinReason, string> = {
  chore_completed: 'משימה הושלמה',
  reward_redeemed: 'פדיון פרס',
  trade_transfer: 'העברת מסחר',
  penalty: 'קנס',
  manual_bonus: 'בונוס',
  refund: 'החזר',
}

type Tab = 'coins' | 'achievements' | 'trades'

export default function ProfilePage() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('coins')
  const { achievements, earnedIds, loading: achLoading } = useAchievements(profile?.id)
  const { transactions, totalEarned, totalSpent, loading: txLoading, error: txError } = useCoinTransactions(profile?.id)
  const { family, loading: familyLoading } = useFamily()
  const [aliasOpen, setAliasOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDeleteAccount() {
    if (!profile) return
    setDeleteSubmitting(true)
    setDeleteError(null)
    const { error } = await supabase.rpc('delete_family_member', { p_user_id: profile.id })
    if (error) { setDeleteError(error.message); setDeleteSubmitting(false); return }
    await signOut()
    navigate('/')
  }

  const loading = txLoading || achLoading

  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: 'coins', icon: '💰', label: 'מטבעות' },
    { key: 'achievements', icon: '🏆', label: 'הישגים' },
    { key: 'trades', icon: '🤝', label: 'מסחר' },
  ]

  const earnedAchievements = achievements.filter(a => earnedIds.has(a.id))

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-col items-center gap-2 py-4">
        <Avatar className="h-20 w-20">
          <AvatarImage src={profile?.avatar_url ?? undefined} />
          <AvatarFallback className="text-2xl">{profile?.name?.[0] ?? 'מ'}</AvatarFallback>
        </Avatar>
        <p className="text-xl font-bold">{profile?.name ?? ''}</p>
        <p className="text-sm text-muted-foreground"><span aria-hidden="true">🪙</span> {profile?.coin_balance ?? 0} מטבעות</p>
        <div className="w-full max-w-xs space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>רמת אמון</span>
            <span>{profile?.trust_level ?? 0} / 5</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${((profile?.trust_level ?? 0) / 5) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      {/* Family card */}
      {!familyLoading && family && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">המשפחה שלי</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <FamilyAvatarUpload family={family} />
            <div>
              <p className="font-medium text-sm">{family.name}</p>
              <div className="flex items-center gap-1">
                <p className="text-xs text-muted-foreground">
                  {family.team_name ?? 'עדיין לא נבחר כינוי'}
                </p>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAliasOpen(true)}>
                  שנה
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div role="tablist" className="flex rounded-lg border overflow-hidden">
        {tabs.map(tab => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            <span aria-hidden="true">{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div role="tabpanel">
      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : activeTab === 'coins' ? (
        <div className="space-y-4">
          {txError && <p role="alert" className="text-sm text-destructive">{txError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">סה&quot;כ הרוויח</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">{totalEarned}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">סה&quot;כ הוציא</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-destructive">{totalSpent}</p>
              </CardContent>
            </Card>
          </div>
          {transactions.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין עדיין עסקאות.</p>
          ) : (
            <div className="space-y-2">
              {transactions.map(tx => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm">{REASON_LABEL[tx.reason]}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(tx.created_at).toLocaleDateString('he-IL')}
                    </p>
                  </div>
                  <span className={`font-semibold text-sm ${tx.amount > 0 ? 'text-green-600' : 'text-destructive'}`}>
                    {tx.amount > 0 ? `+${tx.amount}` : `−${Math.abs(tx.amount)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'achievements' ? (
        <Card>
          <CardContent className="py-4 space-y-3">
            <p className="font-semibold text-center">
              {earnedAchievements.length} מתוך {TOTAL_ACHIEVEMENTS} הישגים
            </p>
            {earnedAchievements.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center text-2xl">
                {earnedAchievements.map(a => (
                  <span key={a.id}>{a.icon}</span>
                ))}
              </div>
            )}
            {earnedAchievements.length === 0 && (
              <p className="text-sm text-muted-foreground text-center">טרם הושגו הישגים.</p>
            )}
            <div className="flex justify-center">
              <Button asChild variant="outline" size="sm">
                <Link to="/player/achievements">ראה את כל ההישגים</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="opacity-50">
          <CardContent className="py-8 flex flex-col items-center gap-2">
            <span className="text-4xl"><span aria-hidden="true">🔒</span></span>
            <p className="text-xl font-semibold">שוק ההחלפות</p>
            <p className="text-sm text-muted-foreground">תכונה זו תהיה זמינה בקרוב</p>
          </CardContent>
        </Card>
      )}
      </div>

      <div className="border-t pt-4">
        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          מחק את החשבון שלי
        </Button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={open => { if (!open) { setDeleteOpen(false); setDeleteError(null) } }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>מחיקת החשבון שלי</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם למחוק את החשבון שלך לצמיתות? פעולה זו אינה ניתנת לביטול.
          </p>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteSubmitting}>ביטול</Button>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleteSubmitting}>
              {deleteSubmitting ? 'מוחק...' : 'מחק חשבון'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {family && (
        <AliasProposalDialog
          open={aliasOpen}
          onOpenChange={setAliasOpen}
          currentAlias={family.team_name}
          activeProposal={null}
          onProposed={() => setAliasOpen(false)}
        />
      )}
    </div>
  )
}
