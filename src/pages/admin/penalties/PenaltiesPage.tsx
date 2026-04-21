import { useState } from 'react'
import { useOverdueAssignments } from '../../../hooks/useOverdueAssignments'
import { usePenaltyPolicy } from '../../../hooks/usePenaltyPolicy'
import { useAppliedPenalties } from '../../../hooks/useAppliedPenalties'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Badge } from '../../../components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'

export default function PenaltiesPage() {
  const { assignments, loading: overdueLoading, waive } = useOverdueAssignments()
  const { policy, update } = usePenaltyPolicy()
  const { penalties, loading: penaltiesLoading, reverse } = useAppliedPenalties()

  const [dayDeduction, setDayDeduction] = useState<string>('')
  const [weekDeduction, setWeekDeduction] = useState<string>('')
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const effectiveDay = dayDeduction !== '' ? Number(dayDeduction) : (policy?.overdue_day_deduction ?? 1)
  const effectiveWeek = weekDeduction !== '' ? Number(weekDeduction) : (policy?.overdue_week_deduction ?? 5)

  async function handleSavePolicy() {
    setPolicyError(null)
    if (effectiveDay <= 0 || effectiveWeek <= 0) {
      setPolicyError('ערכי הקנס חייבים להיות גדולים מאפס')
      return
    }
    const { error } = await update(effectiveDay, effectiveWeek)
    if (error) setPolicyError(error)
  }

  async function handleWaive(assignmentId: string) {
    setActionError(null)
    const { error } = await waive(assignmentId)
    if (error) setActionError(error)
  }

  async function handleReverse(penaltyId: string) {
    setActionError(null)
    const { error } = await reverse(penaltyId)
    if (error) setActionError(error)
  }

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">ניהול הפסדים</h1>

      {actionError && (
        <p className="text-sm text-destructive">{actionError}</p>
      )}

      {/* Policy Editor */}
      <Card>
        <CardHeader>
          <CardTitle>הגדרת קנסות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="day-deduction">קנס יומי (מטבעות)</Label>
              <Input
                id="day-deduction"
                type="number"
                min={1}
                className="w-24"
                value={dayDeduction !== '' ? dayDeduction : (policy?.overdue_day_deduction ?? 1)}
                onChange={e => setDayDeduction(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="week-deduction">קנס שבועי (מטבעות)</Label>
              <Input
                id="week-deduction"
                type="number"
                min={1}
                className="w-24"
                value={weekDeduction !== '' ? weekDeduction : (policy?.overdue_week_deduction ?? 5)}
                onChange={e => setWeekDeduction(e.target.value)}
              />
            </div>
          </div>
          {policyError && <p className="text-sm text-destructive">{policyError}</p>}
          <Button onClick={handleSavePolicy}>שמור</Button>
        </CardContent>
      </Card>

      {/* Overdue Assignments — Pre-batch waiver */}
      <Card>
        <CardHeader>
          <CardTitle>משימות באיחור — ויתור לפני קנס</CardTitle>
        </CardHeader>
        <CardContent>
          {overdueLoading ? (
            <div role="status" className="text-muted-foreground text-sm">טוען...</div>
          ) : assignments.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין משימות באיחור</p>
          ) : (
            <div className="space-y-2">
              {assignments.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded border p-2">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={a.profiles.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">{a.profiles.name[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{a.profiles.name}</p>
                      <p className="text-xs text-muted-foreground">{a.chores.title}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleWaive(a.id)}>
                    ויתור על הפסד
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Applied Penalties — Post-batch reversal */}
      <Card>
        <CardHeader>
          <CardTitle>הפסדים שהוחלו</CardTitle>
        </CardHeader>
        <CardContent>
          {penaltiesLoading ? (
            <div role="status" className="text-muted-foreground text-sm">טוען...</div>
          ) : penalties.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין הפסדים שהוחלו</p>
          ) : (
            <div className="space-y-2">
              {penalties.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded border p-2">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={p.profiles.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">{p.profiles.name[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{p.profiles.name}</p>
                      <p className="text-xs text-muted-foreground">{p.chore_assignments.chores.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.applied_at).toLocaleDateString('he-IL')} — {p.coin_deduction} מטבעות
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.waived_by ? (
                      <Badge variant="secondary">בוטל</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleReverse(p.id)}>
                        בטל הפסד
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
