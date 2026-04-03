import { Link } from 'react-router-dom'
import { useChores } from '../../../hooks/useChores'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Separator } from '../../../components/ui/separator'
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

  const activeChores = chores.filter(c => c.status === 'active')
  const pendingChores = chores.filter(c => c.status === 'pending_approval')

  function memberName(id: string | null): string {
    if (!id) return 'בריכה פתוחה'
    return members.find(m => m.id === id)?.name ?? id.slice(0, 8)
  }

  async function archiveChore(chore: Chore) {
    await supabase.from('chores').update({ status: 'archived' }).eq('id', chore.id)
    refetch()
  }

  async function approveChore(chore: Chore) {
    await supabase
      .from('chores')
      .update({ status: 'active', approved_by: profile?.id })
      .eq('id', chore.id)
    refetch()
  }

  async function rejectChore(chore: Chore) {
    await supabase.from('chores').update({ status: 'archived' }).eq('id', chore.id)
    refetch()
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
                  <Button size="sm" variant="outline" onClick={() => rejectChore(chore)}>דחה</Button>
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
