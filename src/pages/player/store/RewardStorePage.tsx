import { useState } from 'react'
import { useRewards } from '../../../hooks/useRewards'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog'
import type { Reward } from '../../../types/database'

export default function RewardStorePage() {
  const { rewards, loading } = useRewards()
  const [confirmTarget, setConfirmTarget] = useState<Reward | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const storeRewards = rewards.filter(r => r.type === 'store')

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
      <h1 className="text-2xl font-bold">החנות</h1>

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
