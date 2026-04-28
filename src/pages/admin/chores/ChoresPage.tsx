import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useChores } from '../../../hooks/useChores'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Separator } from '../../../components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import type { Chore, ChoreDifficulty } from '../../../types/database'

const difficultyLabel: Record<ChoreDifficulty, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

const difficultyVariant: Record<ChoreDifficulty, 'secondary' | 'default' | 'destructive'> = {
  easy: 'secondary',
  medium: 'default',
  hard: 'destructive',
}

export default function ChoresPage() {
  const { chores, loading, error, refetch } = useChores()
  const { members } = useFamilyMembers()
  const { profile } = useAuth()
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [choreToDelete, setChoreToDelete] = useState<Chore | null>(null)
  const [pendingWarningChoreId, setPendingWarningChoreId] = useState<string | null>(null)
  const [rejectionTarget, setRejectionTarget] = useState<Chore | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')

  const activeChores = chores.filter(c => c.status === 'active')
  const pendingChores = chores.filter(c => c.status === 'pending_approval')

  function memberName(id: string | null): string {
    if (!id) return 'מאגר משימות פתוח'
    return members.find(m => m.id === id)?.name ?? id.slice(0, 8)
  }

  async function archiveChore(chore: Chore) {
    setMutationError(null)
    const { error } = await supabase.from('chores').update({ status: 'archived' }).eq('id', chore.id)
    if (error) { setMutationError('שגיאה בארכוב המשימה') } else { refetch() }
  }

  async function approveChore(chore: Chore) {
    setMutationError(null)
    const { error } = await supabase
      .from('chores')
      .update({ status: 'active', approved_by: profile?.id })
      .eq('id', chore.id)
    if (error) { setMutationError('שגיאה באישור ההצעה') } else { refetch() }
  }

  function openRejectDialog(chore: Chore) {
    setMutationError(null)
    setRejectionReason('')
    setRejectionTarget(chore)
  }

  async function confirmRejectChore() {
    if (!rejectionTarget) return
    setMutationError(null)
    const reason = rejectionReason.trim() || null
    const { error } = await supabase
      .from('chores')
      .update({ status: 'archived', proposal_rejection_reason: reason })
      .eq('id', rejectionTarget.id)
    if (error) {
      setMutationError('שגיאה בדחיית ההצעה')
    } else {
      setRejectionTarget(null)
      setRejectionReason('')
      refetch()
    }
  }

  async function handleDeleteClick(chore: Chore) {
    setMutationError(null)
    setPendingWarningChoreId(null)
    // UX hint only — server enforces this rule regardless
    const { data: assignments, error: assignmentsError } = await supabase
      .from('chore_assignments')
      .select('id')
      .eq('chore_id', chore.id)
    if (assignmentsError) { setMutationError('שגיאה בבדיקת המשימה'); return }
    const ids = (assignments ?? []).map(a => a.id)
    if (ids.length > 0) {
      const { data: pending, error: pendingError } = await supabase
        .from('chore_completions')
        .select('id')
        .in('chore_assignment_id', ids)
        .eq('status', 'pending')
        .limit(1)
      if (pendingError) { setMutationError('שגיאה בבדיקת המשימה'); return }
      if ((pending ?? []).length > 0) {
        setPendingWarningChoreId(chore.id)
        return
      }
    }
    setChoreToDelete(chore)
  }

  async function confirmDeleteChore(chore: Chore) {
    setMutationError(null)
    const { error } = await supabase.rpc('delete_chore', { p_chore_id: chore.id })
    if (error) {
      const msg = error.message ?? ''
      if (msg.includes('PENDING_COMPLETIONS')) {
        setMutationError('לא ניתן למחוק - ישנה משימה הדורשת אישור או דחייה')
      } else if (msg.includes('INVALID_STATUS')) {
        setMutationError('לא ניתן למחוק משימה בסטטוס זה')
      } else if (msg.includes('UNAUTHORIZED')) {
        setMutationError('אין הרשאה למחוק משימה זו')
      } else {
        setMutationError('שגיאה במחיקת המשימה')
      }
    } else {
      setChoreToDelete(null)
      refetch()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div role="status" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return <p className="text-destructive py-4">{error}</p>
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ניהול משימות</h1>
        <Button asChild>
          <Link to="/admin/chores/new">משימה חדשה</Link>
        </Button>
      </div>

      {mutationError && !choreToDelete && (
        <p role="alert" className="text-sm text-destructive">{mutationError}</p>
      )}

      {pendingChores.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">הצעות ממתינות לאישור</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingChores.map(chore => (
              <div key={chore.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{chore.title}</p>
                  <p className="text-sm text-muted-foreground">
                    הוצע ע״י {memberName(chore.proposed_by)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveChore(chore)}>אשר</Button>
                  <Button size="sm" variant="outline" onClick={() => openRejectDialog(chore)}>דחה</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">משימות פעילות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {activeChores.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין משימות פעילות</p>
          ) : (
            activeChores.map((chore, i) => (
              <div key={chore.id}>
                {i > 0 && <Separator className="my-2" />}
                <div className="flex items-center justify-between py-1">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{chore.title}</span>
                      <Badge variant={difficultyVariant[chore.difficulty]}>
                        {difficultyLabel[chore.difficulty]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {chore.coin_value} מטבעות · {memberName(chore.assigned_to)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/admin/chores/${chore.id}/edit`}>עריכה</Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => archiveChore(chore)}>
                      ארכיון
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDeleteClick(chore)}>
                      מחק
                    </Button>
                  </div>
                </div>
                {pendingWarningChoreId === chore.id && (
                  <p role="alert" className="text-xs text-destructive mt-1">
                    לא ניתן למחוק - ישנה משימה הדורשת אישור או דחייה
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={choreToDelete !== null} onOpenChange={(open) => { if (!open) { setChoreToDelete(null); setPendingWarningChoreId(null); setMutationError(null) } }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>מחיקת משימה</DialogTitle>
            <DialogDescription>
              האם למחוק את המשימה &quot;{choreToDelete?.title}&quot;? לא ניתן לשחזר.
            </DialogDescription>
          </DialogHeader>
          {mutationError && (
            <p role="alert" className="text-sm text-destructive">{mutationError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setChoreToDelete(null); setMutationError(null) }}>ביטול</Button>
            <Button
              variant="destructive"
              onClick={() => { if (choreToDelete) confirmDeleteChore(choreToDelete) }}
            >
              מחק
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectionTarget !== null}
        onOpenChange={(open) => {
          if (!open) { setRejectionTarget(null); setRejectionReason('') }
        }}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>דחיית הצעה</DialogTitle>
            <DialogDescription>
              סיבת הדחייה (אופציונלי)
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="ניתן להשאיר ריק..."
            maxLength={500}
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectionTarget(null); setRejectionReason('') }}>
              ביטול
            </Button>
            <Button variant="destructive" onClick={confirmRejectChore}>
              דחה הצעה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
