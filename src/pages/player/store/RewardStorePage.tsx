import { useState } from 'react'
import { useRewards } from '../../../hooks/useRewards'
import { useAuth } from '../../../contexts/AuthContext'
import { useMyProposals } from '../../../hooks/useMyProposals'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog'
import type { Reward } from '../../../types/database'

export default function RewardStorePage() {
  const { profile } = useAuth()
  const { rewards, loading } = useRewards()
  const { proposals: myProposals, refetch: refetchProposals } = useMyProposals(
    'rewards', profile?.id, profile?.family_id ?? undefined
  )
  const [confirmTarget, setConfirmTarget] = useState<Reward | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Proposal form state
  const [proposalOpen, setProposalOpen] = useState(false)
  const [proposalTitle, setProposalTitle] = useState('')
  const [proposalDescription, setProposalDescription] = useState('')
  const [proposalCoinCost, setProposalCoinCost] = useState('10')
  const [proposalSubmitting, setProposalSubmitting] = useState(false)
  const [proposalError, setProposalError] = useState<string | null>(null)

  // Dismissal state
  const [dismissTarget, setDismissTarget] = useState<Reward | null>(null)
  const [dismissing, setDismissing] = useState(false)

  const storeRewards = rewards.filter(r => r.type === 'store')

  async function submitProposal() {
    if (!profile) return
    setProposalSubmitting(true)
    setProposalError(null)
    const { error } = await supabase.from('rewards').insert({
      title: proposalTitle.trim(),
      description: proposalDescription.trim() || null,
      coin_cost: parseInt(proposalCoinCost, 10),
      status: 'pending_approval',
      proposed_by: profile.id,
      family_id: profile.family_id,
    })
    setProposalSubmitting(false)
    if (error) {
      setProposalError('שגיאה בשליחת ההצעה')
      return
    }
    setProposalOpen(false)
    setProposalTitle('')
    setProposalDescription('')
    setProposalCoinCost('10')
    refetchProposals()
  }

  async function handleDismiss() {
    if (!dismissTarget) return
    setDismissing(true)
    const { error } = await supabase.rpc('dismiss_rejected_proposal', {
      p_entity_type: 'reward',
      p_entity_id: dismissTarget.id,
    })
    setDismissing(false)
    setDismissTarget(null)
    if (!error) {
      refetchProposals()
    }
  }

  async function confirmRedeem() {
    if (!confirmTarget) return
    setRedeeming(true)
    setError(null)
    const { error } = await supabase.rpc('redeem_reward', { p_reward_id: confirmTarget.id })
    setRedeeming(false)
    if (error) {
      if (error.message.includes('Insufficient coin balance')) {
        setError('אין מספיק מטבעות')
      } else if (error.message.includes('out of stock')) {
        setError('הפרס אזל מהמלאי')
      } else {
        setError('שגיאה בממשק הפרס')
      }
      setConfirmTarget(null)
      return
    }
    setSuccessMsg(`${confirmTarget.title} הוזמן בהצלחה!`)
    setConfirmTarget(null)
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">החנות</h1>
        <Button size="sm" variant="outline" onClick={() => { setProposalError(null); setProposalOpen(true) }}>
          הצע מתנה חדשה
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {successMsg && <p className="text-sm text-green-600 font-medium">{successMsg}</p>}

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : storeRewards.length === 0 ? (
        <p className="text-muted-foreground">אין פרסים זמינים כרגע.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {storeRewards.map(reward => (
            <Card key={reward.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{reward.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {reward.description && (
                  <p className="text-sm text-muted-foreground">{reward.description}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="font-semibold">🪙 {reward.coin_cost} מטבעות</span>
                  {reward.stock !== null && (
                    <span className="text-xs text-muted-foreground">מלאי: {reward.stock}</span>
                  )}
                </div>
                <Button
                  className="w-full"
                  disabled={reward.stock === 0}
                  onClick={() => { setError(null); setSuccessMsg(null); setConfirmTarget(reward) }}
                >
                  מימוש
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {myProposals.length > 0 && (
        <div className="space-y-3 mt-6">
          <h2 className="text-lg font-semibold">ההצעות שלי</h2>
          {myProposals.map(proposal => (
            <Card key={proposal.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div
                  className={proposal.status === 'archived' ? 'cursor-pointer' : undefined}
                  onClick={proposal.status === 'archived' ? () => setDismissTarget(proposal) : undefined}
                >
                  <p className="font-medium">{proposal.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground">{proposal.coin_cost} מטבעות</span>
                    {proposal.status === 'pending_approval' ? (
                      <Badge variant="secondary">ממתין לאישור</Badge>
                    ) : (
                      <Badge variant="destructive">נדחה</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Proposal form dialog */}
      <Dialog open={proposalOpen} onOpenChange={(open) => { if (!open) { setProposalOpen(false); setProposalError(null) } }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>הצע פרס חדש</DialogTitle>
            <DialogDescription>מלא את הפרטים וההצעה תישלח לאישור המנהל</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label htmlFor="proposal-title" className="text-sm font-medium">כותרת</label>
              <input
                id="proposal-title"
                aria-label="כותרת"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={proposalTitle}
                onChange={(e) => setProposalTitle(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="proposal-desc" className="text-sm font-medium">תיאור (אופציונלי)</label>
              <textarea
                id="proposal-desc"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                value={proposalDescription}
                onChange={(e) => setProposalDescription(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="proposal-coins" className="text-sm font-medium">עלות במטבעות</label>
              <input
                id="proposal-coins"
                aria-label="עלות במטבעות"
                type="number"
                min={1}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={proposalCoinCost}
                onChange={(e) => setProposalCoinCost(e.target.value)}
              />
            </div>
            {proposalError && <p role="alert" className="text-sm text-destructive">{proposalError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProposalOpen(false)}>ביטול</Button>
            <Button
              onClick={submitProposal}
              disabled={!proposalTitle.trim() || parseInt(proposalCoinCost, 10) < 1 || proposalSubmitting}
            >
              {proposalSubmitting ? '...' : 'שלח הצעה'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dismissal dialog */}
      <Dialog open={dismissTarget !== null} onOpenChange={(open) => { if (!open) setDismissTarget(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>הצעה נדחתה</DialogTitle>
            <DialogDescription className="sr-only">פרטי הדחייה</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {dismissTarget?.proposal_rejection_reason
              ? `הצעתך נדחתה על ידי המנהל: ${dismissTarget.proposal_rejection_reason}`
              : 'הצעתך נדחתה על ידי המנהל'}
          </p>
          <DialogFooter>
            <Button onClick={handleDismiss} disabled={dismissing}>
              {dismissing ? '...' : 'אישור'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmTarget} onOpenChange={open => { if (!open) setConfirmTarget(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>אישור מימוש</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            לממש את <span className="font-semibold">{confirmTarget?.title}</span> תמורת{' '}
            <span className="font-semibold">{confirmTarget?.coin_cost} מטבעות</span>?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>ביטול</Button>
            <Button onClick={confirmRedeem} disabled={redeeming}>
              {redeeming ? 'מממש...' : 'אשר מימוש'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
