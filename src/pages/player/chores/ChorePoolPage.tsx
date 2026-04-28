import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useChores } from '../../../hooks/useChores'
import { useChoreAssignments } from '../../../hooks/useChoreAssignments'
import { useAuth } from '../../../contexts/AuthContext'
import { useMyProposals } from '../../../hooks/useMyProposals'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent } from '../../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { assignmentErrorMessage } from '../../../lib/assignmentErrors'
import type { Chore, ChoreDifficulty } from '../../../types/database'

const difficultyLabel: Record<ChoreDifficulty, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

export default function ChorePoolPage() {
  const { profile } = useAuth()
  const { chores, loading: choresLoading, refetch } = useChores()
  const { assignments } = useChoreAssignments(profile?.id)
  const navigate = useNavigate()

  const { proposals: myProposals, refetch: refetchProposals } = useMyProposals(
    'chores', profile?.id, profile?.family_id ?? undefined
  )

  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Proposal form state
  const [proposalOpen, setProposalOpen] = useState(false)
  const [proposalTitle, setProposalTitle] = useState('')
  const [proposalDescription, setProposalDescription] = useState('')
  const [proposalCoinValue, setProposalCoinValue] = useState('5')
  const [proposalDifficulty, setProposalDifficulty] = useState<ChoreDifficulty>('easy')
  const [proposalSubmitting, setProposalSubmitting] = useState(false)
  const [proposalError, setProposalError] = useState<string | null>(null)

  // Dismissal state
  const [dismissTarget, setDismissTarget] = useState<Chore | null>(null)
  const [dismissing, setDismissing] = useState(false)

  // Non-recurring chores the player already holds — hide them from the pool
  const nonRecurringAssignedIds = new Set(
    assignments
      .filter(a => {
        const chore = chores.find(c => c.id === a.chore_id)
        return chore?.recurrence_type === 'none'
      })
      .map(a => a.chore_id)
  )

  const poolChores = chores.filter(c => {
    if (c.status !== 'active' || !c.is_pool_visible) return false
    if (c.recurrence_type === 'none') return !nonRecurringAssignedIds.has(c.id)
    return true
  })

  async function handleAssign(choreId: string, recurrenceType: string) {
    setAssigningId(choreId)
    setError(null)

    const { data, error: fnError } = await supabase.functions.invoke('self-assign-chore', {
      body: { chore_id: choreId, calendar_day: null, calendar_slot: null },
    })

    setAssigningId(null)

    if (fnError || !data?.ok) {
      console.log('[chore-assign] fnError:', fnError, 'data:', data)
      let code = 'INTERNAL_ERROR'
      let debugInfo = ''
      if (fnError?.context) {
        try {
          const body = await fnError.context.json()
          console.log('[chore-assign] error body:', body)
          code = body.error ?? 'INTERNAL_ERROR'
          debugInfo = body._debug ?? ''
        } catch (e) { console.log('[chore-assign] context.json() failed:', e) }
      }
      setError(debugInfo ? `[debug] ${debugInfo}` : assignmentErrorMessage(code))
      return
    }
    console.log('[chore-assign] success, data:', data)

    if (recurrenceType === 'none') {
      navigate('/player')
    } else {
      refetch()
    }
  }

  async function submitProposal() {
    if (!profile) return
    setProposalSubmitting(true)
    setProposalError(null)
    const { error } = await supabase.from('chores').insert({
      title: proposalTitle.trim(),
      description: proposalDescription.trim() || null,
      coin_value: parseInt(proposalCoinValue, 10),
      difficulty: proposalDifficulty,
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
    setProposalCoinValue('5')
    setProposalDifficulty('easy')
    refetchProposals()
  }

  async function handleDismiss() {
    if (!dismissTarget) return
    setDismissing(true)
    const { error } = await supabase.rpc('dismiss_rejected_proposal', {
      p_entity_type: 'chore',
      p_entity_id: dismissTarget.id,
    })
    setDismissing(false)
    setDismissTarget(null)
    if (!error) {
      refetchProposals()
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/player">← חזרה</Link>
          </Button>
          <h1 className="text-2xl font-bold">בחר משימה</h1>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setProposalError(null); setProposalOpen(true) }}>
          הצע משימה
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {choresLoading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : poolChores.length === 0 ? (
        <p className="text-muted-foreground">אין משימות זמינות כרגע.</p>
      ) : (
        <div className="space-y-3">
          {poolChores.map(chore => (
            <Card key={chore.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{chore.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground">{chore.coin_value} מטבעות</span>
                    <Badge variant="secondary">{difficultyLabel[chore.difficulty]}</Badge>
                    {chore.recurrence_type !== 'none' && (
                      <Badge variant="outline" className="text-xs">🔁</Badge>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={assigningId === chore.id}
                  onClick={() => handleAssign(chore.id, chore.recurrence_type)}
                  aria-label={`בחר ${chore.title}`}
                >
                  {assigningId === chore.id ? '...' : 'קח משימה'}
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
                    <span className="text-sm text-muted-foreground">{proposal.coin_value} מטבעות</span>
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
            <DialogTitle>הצע משימה חדשה</DialogTitle>
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
              <label htmlFor="proposal-coins" className="text-sm font-medium">ערך במטבעות</label>
              <input
                id="proposal-coins"
                aria-label="ערך במטבעות"
                type="number"
                min={1}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={proposalCoinValue}
                onChange={(e) => setProposalCoinValue(e.target.value)}
              />
            </div>
            <div>
              <span className="text-sm font-medium">קושי</span>
              <div className="flex gap-3 mt-1">
                {(['easy', 'medium', 'hard'] as ChoreDifficulty[]).map(d => (
                  <label key={d} className="flex items-center gap-1 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="difficulty"
                      value={d}
                      checked={proposalDifficulty === d}
                      onChange={() => setProposalDifficulty(d)}
                    />
                    {d === 'easy' ? 'קל' : d === 'medium' ? 'בינוני' : 'קשה'}
                  </label>
                ))}
              </div>
            </div>
            {proposalError && <p role="alert" className="text-sm text-destructive">{proposalError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProposalOpen(false)}>ביטול</Button>
            <Button
              onClick={submitProposal}
              disabled={!proposalTitle.trim() || parseInt(proposalCoinValue, 10) < 1 || proposalSubmitting}
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
    </div>
  )
}
