import { useState } from 'react'
import { usePendingCompletions, type CompletionWithDetails } from '../../../hooks/usePendingCompletions'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog'
import { Textarea } from '../../../components/ui/textarea'
import { Label } from '../../../components/ui/label'

export default function CompletionsPage() {
  const { completions, loading, refetch } = usePendingCompletions()
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<CompletionWithDetails | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')

  async function deletePhoto(photoUrl: string) {
    await supabase.storage.from('completion-photos').remove([photoUrl])
  }

  async function viewPhoto(photoUrl: string) {
    const { data } = await supabase.storage
      .from('completion-photos')
      .createSignedUrl(photoUrl, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function approve(completion: CompletionWithDetails) {
    setActionError(null)
    const { error } = await supabase.rpc('approve_completion', { completion_id: completion.id })
    if (error) {
      if (error.message.includes('not pending')) {
        setActionError('הגשה זו כבר אושרה על ידי מנהל אחר')
        refetch()
      } else {
        setActionError('שגיאה באישור ההגשה')
      }
      return
    }
    if (completion.photo_url) await deletePhoto(completion.photo_url)
    refetch()
  }

  async function confirmReject() {
    if (!rejectTarget || !rejectionReason.trim()) return
    setActionError(null)
    const { error } = await supabase.rpc('reject_completion', {
      completion_id: rejectTarget.id,
      reason: rejectionReason.trim(),
    })
    if (error) { setActionError('שגיאה בדחיית ההגשה'); setRejectTarget(null); return }
    if (rejectTarget.photo_url) await deletePhoto(rejectTarget.photo_url)
    setRejectTarget(null)
    setRejectionReason('')
    refetch()
  }

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">אישור הגשות</h1>

      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : completions.length === 0 ? (
        <p className="text-muted-foreground">אין הגשות ממתינות לאישור.</p>
      ) : (
        <div className="space-y-3">
          {completions.map(c => (
            <Card key={c.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{c.chore_assignments.chores.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {c.profiles.name} · {new Date(c.completed_at).toLocaleDateString('he-IL')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {c.photo_url && (
                      <Button variant="outline" size="sm" onClick={() => viewPhoto(c.photo_url!)}>
                        צפה בתמונה
                      </Button>
                    )}
                    <Button size="sm" onClick={() => approve(c)}>אשר</Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => { setRejectTarget(c); setRejectionReason('') }}
                    >
                      דחה
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={open => { if (!open) setRejectTarget(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>סיבת דחייה</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rejectionReason">הסבר לשחקן</Label>
            <Textarea
              id="rejectionReason"
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              rows={3}
              placeholder="למשל: התמונה לא ברורה מספיק..."
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectTarget(null)}>ביטול</Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={!rejectionReason.trim()}
            >
              דחה הגשה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
