import { useState } from 'react'
import { usePendingRedemptions, type RedemptionWithDetails } from '../../../hooks/usePendingRedemptions'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'

export default function RedemptionsPage() {
  const { redemptions, loading, refetch } = usePendingRedemptions()
  const [actionError, setActionError] = useState<string | null>(null)

  async function grant(redemption: RedemptionWithDetails) {
    setActionError(null)
    const { error } = await supabase
      .from('reward_redemptions')
      .update({ status: 'granted', resolved_at: new Date().toISOString() })
      .eq('id', redemption.id)
    if (error) { setActionError('שגיאה במתן הפרס'); return }
    refetch()
  }

  async function decline(redemption: RedemptionWithDetails) {
    setActionError(null)
    const { error } = await supabase.rpc('decline_redemption', { p_redemption_id: redemption.id })
    if (error) { setActionError('שגיאה בדחיית הבקשה'); return }
    refetch()
  }

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">בקשות מימוש</h1>

      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : redemptions.length === 0 ? (
        <p className="text-muted-foreground">אין בקשות מימוש ממתינות.</p>
      ) : (
        <div className="space-y-3">
          {redemptions.map(r => (
            <Card key={r.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{r.rewards.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.profiles.name} · {r.coin_cost_at_time} מטבעות · {new Date(r.redeemed_at).toLocaleDateString('he-IL')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button size="sm" onClick={() => grant(r)}>אשר</Button>
                    <Button variant="destructive" size="sm" onClick={() => decline(r)}>דחה</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
