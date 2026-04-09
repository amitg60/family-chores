import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import type { FamilyAliasProposal } from '../../types/database'

interface AliasProposalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentAlias: string | null
  activeProposal: FamilyAliasProposal | null
  onProposed: () => void
}

export default function AliasProposalDialog({
  open,
  onOpenChange,
  currentAlias,
  activeProposal,
  onProposed,
}: AliasProposalDialogProps) {
  const [newAlias, setNewAlias] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!newAlias.trim()) return
    setLoading(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('propose_alias_change', {
      p_new_alias: newAlias.trim(),
    })
    setLoading(false)
    if (rpcError) {
      setError(
        rpcError.message === 'active_proposal_exists'
          ? 'כבר קיימת הצעה פעילה לשינוי הכינוי'
          : rpcError.message
      )
      return
    }
    onProposed()
    onOpenChange(false)
    setNewAlias('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>שינוי כינוי המשפחה</DialogTitle>
        </DialogHeader>

        {activeProposal ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">קיימת הצעה פעילה לכינוי:</p>
            <p className="font-medium">"{activeProposal.proposed_alias}"</p>
            <p className="text-xs text-muted-foreground">
              ההצבעה תסתיים ב-{new Date(activeProposal.expires_at).toLocaleTimeString('he-IL')}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {currentAlias && (
              <p className="text-sm text-muted-foreground">
                כינוי נוכחי:{' '}
                <span className="font-medium text-foreground">{currentAlias}</span>
              </p>
            )}
            <Input
              placeholder="כינוי חדש"
              value={newAlias}
              onChange={e => setNewAlias(e.target.value)}
              required
              aria-label="כינוי חדש"
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !newAlias.trim()}
            >
              {loading ? 'שולח...' : 'הצעת שינוי'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
