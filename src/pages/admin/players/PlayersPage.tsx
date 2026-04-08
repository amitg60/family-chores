import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { supabase } from '../../../lib/supabase'
import { Card, CardContent } from '../../../components/ui/card'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import type { Profile } from '../../../types/database'

export default function PlayersPage() {
  const { profile: adminProfile } = useAuth()
  const { members, loading, error, refetch } = useFamilyMembers()
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bonusTarget, setBonusTarget] = useState<Profile | null>(null)
  const [bonusAmount, setBonusAmount] = useState('')
  const [bonusSubmitting, setBonusSubmitting] = useState(false)

  const players = members.filter(m => m.role === 'player')

  async function handleTrustChange(target: Profile, delta: -1 | 1) {
    const newLevel = (target.trust_level ?? 1) + delta
    if (newLevel < 1 || newLevel > 5) return
    setActionError(null)
    setBusyId(target.id)
    const { error } = await supabase.rpc('set_trust_level', {
      p_target_user_id: target.id,
      p_new_level: newLevel,
    })
    setBusyId(null)
    if (error) { setActionError(error.message) } else { refetch() }
  }

  async function handleGrantBonus() {
    const amount = parseInt(bonusAmount, 10)
    if (!bonusTarget || !adminProfile || isNaN(amount) || amount <= 0) return
    setBonusSubmitting(true)
    setActionError(null)
    const { error } = await supabase.rpc('grant_manual_bonus', {
      p_target_user_id: bonusTarget.id,
      p_amount: amount,
      p_family_id: adminProfile.family_id!,
    })
    setBonusSubmitting(false)
    if (error) {
      setActionError(error.message)
    } else {
      setBonusTarget(null)
      setBonusAmount('')
      refetch()
    }
  }

  if (loading) return <div role="status" className="text-muted-foreground py-8 text-center">טוען...</div>

  return (
    <div className="space-y-4" dir="rtl">
      <h1 className="text-2xl font-bold">ניהול שחקנים</h1>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      <div className="space-y-3">
        {players.map(player => (
          <Card key={player.id}>
            <CardContent className="py-3 flex flex-wrap items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={player.avatar_url ?? undefined} />
                <AvatarFallback>{player.name[0]}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{player.name}</p>
                <p className="text-xs text-muted-foreground">🪙 {player.coin_balance}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">רמת אמון</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(player.trust_level ?? 1) <= 1 || busyId === player.id}
                  onClick={() => handleTrustChange(player, -1)}
                  aria-label={`הורד רמת אמון של ${player.name}`}
                >
                  −
                </Button>
                <Badge variant="secondary">{player.trust_level}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(player.trust_level ?? 1) >= 5 || busyId === player.id}
                  onClick={() => handleTrustChange(player, 1)}
                  aria-label={`העלה רמת אמון של ${player.name}`}
                >
                  +
                </Button>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setBonusTarget(player); setBonusAmount('') }}
              >
                מענק בונוס
              </Button>
            </CardContent>
          </Card>
        ))}
        {players.length === 0 && (
          <p className="text-muted-foreground text-sm">אין שחקנים במשפחה.</p>
        )}
      </div>

      <Dialog open={!!bonusTarget} onOpenChange={open => { if (!open) setBonusTarget(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>מענק בונוס ל{bonusTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="number"
              min="1"
              placeholder="מספר מטבעות"
              value={bonusAmount}
              onChange={e => setBonusAmount(e.target.value)}
              aria-label="כמות מטבעות"
            />
            <Button
              className="w-full"
              disabled={bonusSubmitting || !bonusAmount || parseInt(bonusAmount, 10) <= 0}
              onClick={handleGrantBonus}
            >
              {bonusSubmitting ? 'שולח...' : 'מענק'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
