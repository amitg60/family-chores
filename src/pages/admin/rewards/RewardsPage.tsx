import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useRewards } from '../../../hooks/useRewards'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Separator } from '../../../components/ui/separator'
import type { Reward } from '../../../types/database'

export default function RewardsPage() {
  const { rewards, loading, error, refetch } = useRewards()
  const [mutationError, setMutationError] = useState<string | null>(null)

  const activeRewards = rewards.filter(r => r.status === 'active')
  const pendingRewards = rewards.filter(r => r.status === 'pending_approval')

  async function archiveReward(reward: Reward) {
    setMutationError(null)
    const { error } = await supabase.from('rewards').update({ status: 'archived' }).eq('id', reward.id)
    if (error) { setMutationError('שגיאה בארכוב הפרס') } else { refetch() }
  }

  async function approveReward(reward: Reward) {
    setMutationError(null)
    const { error } = await supabase.from('rewards').update({ status: 'active' }).eq('id', reward.id)
    if (error) { setMutationError('שגיאה באישור ההצעה') } else { refetch() }
  }

  async function rejectReward(reward: Reward) {
    setMutationError(null)
    const { error } = await supabase.from('rewards').update({ status: 'archived' }).eq('id', reward.id)
    if (error) { setMutationError('שגיאה בדחיית ההצעה') } else { refetch() }
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
        <h1 className="text-2xl font-bold">ניהול פרסים</h1>
        <Button asChild>
          <Link to="/admin/rewards/new">פרס חדש</Link>
        </Button>
      </div>

      {mutationError && (
        <p role="alert" className="text-sm text-destructive">{mutationError}</p>
      )}

      {pendingRewards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">הצעות ממתינות לאישור</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingRewards.map(reward => (
              <div key={reward.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{reward.title}</p>
                  <p className="text-sm text-muted-foreground">{reward.coin_cost} מטבעות</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveReward(reward)}>אשר</Button>
                  <Button size="sm" variant="outline" onClick={() => rejectReward(reward)}>דחה</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">פרסים פעילים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {activeRewards.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין פרסים פעילים</p>
          ) : (
            activeRewards.map((reward, i) => (
              <div key={reward.id}>
                {i > 0 && <Separator className="my-2" />}
                <div className="flex items-center justify-between py-1">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{reward.title}</span>
                      {reward.stock !== null && (
                        <Badge variant="secondary">מלאי: {reward.stock}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{reward.coin_cost} מטבעות</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/admin/rewards/${reward.id}/edit`}>עריכה</Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => archiveReward(reward)}>
                      ארכיון
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
