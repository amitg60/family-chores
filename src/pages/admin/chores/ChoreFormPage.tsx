import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Textarea } from '../../../components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import type { ChoreDifficulty, ChoreStatus, RecurrenceType } from '../../../types/database'

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

export default function ChoreFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id !== undefined
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { members } = useFamilyMembers()

  const [title, setTitle]                   = useState('')
  const [description, setDescription]       = useState('')
  const [coinValue, setCoinValue]           = useState('1')
  const [difficulty, setDifficulty]         = useState<ChoreDifficulty>('easy')
  const [assignedTo, setAssignedTo]         = useState('none')
  const [dueDate, setDueDate]               = useState('')
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none')
  const [dailySchedule, setDailySchedule]   = useState<Record<string, number[]>>({})
  const [weeklyAssignees, setWeeklyAssignees] = useState<string[]>([])
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  useEffect(() => {
    if (!isEditMode) return
    supabase
      .from('chores')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setError('שגיאה בטעינת המשימה'); return }
        setTitle(data.title)
        setDescription(data.description ?? '')
        setCoinValue(String(data.coin_value))
        setDifficulty(data.difficulty as ChoreDifficulty)
        setAssignedTo(data.assigned_to ?? 'none')
        setDueDate(data.due_date ?? '')
        setRecurrenceType((data.recurrence_type as RecurrenceType) ?? 'none')
      })
  }, [id, isEditMode])

  useEffect(() => {
    if (!isEditMode || !id) return
    supabase
      .from('chore_schedule')
      .select('*')
      .eq('chore_id', id)
      .then(({ data }) => {
        if (!data || data.length === 0) return
        if (data[0].day_of_week !== null) {
          const daily: Record<string, number[]> = {}
          for (const row of data) {
            if (row.day_of_week !== null) {
              daily[row.assigned_to] = [...(daily[row.assigned_to] ?? []), row.day_of_week]
            }
          }
          setDailySchedule(daily)
        } else {
          setWeeklyAssignees(data.map((r: { assigned_to: string }) => r.assigned_to))
        }
      })
  }, [id, isEditMode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      if (!profile?.family_id) { setError('שגיאה בשמירת המשימה'); return }

      const payload = {
        title,
        description: description || null,
        coin_value: Number(coinValue),
        difficulty,
        assigned_to: recurrenceType === 'none' && assignedTo !== 'none' ? assignedTo : null,
        due_date: dueDate || null,
        recurrence_type: recurrenceType,
      }

      let choreId: string
      if (isEditMode) {
        const { error: err } = await supabase.from('chores').update(payload).eq('id', id!)
        if (err) { setError('שגיאה בשמירת המשימה'); return }
        choreId = id!
      } else {
        const { data, error: err } = await supabase
          .from('chores')
          .insert({ ...payload, family_id: profile.family_id, status: 'active' as ChoreStatus })
          .select('id')
          .single()
        if (err || !data) { setError('שגיאה בשמירת המשימה'); return }
        choreId = data.id
      }

      if (recurrenceType !== 'none') {
        const { error: deleteErr } = await supabase.from('chore_schedule').delete().eq('chore_id', choreId)
        if (deleteErr) { setError('שגיאה בשמירת הלוח זמנים'); return }
        const scheduleRows =
          recurrenceType === 'daily'
            ? Object.entries(dailySchedule).flatMap(([userId, days]) =>
                days.map(day => ({
                  chore_id: choreId,
                  day_of_week: day,
                  assigned_to: userId,
                }))
              )
            : weeklyAssignees.map(userId => ({
                chore_id: choreId,
                day_of_week: null,
                assigned_to: userId,
              }))
        if (scheduleRows.length > 0) {
          const { error: schedErr } = await supabase.from('chore_schedule').insert(scheduleRows)
          if (schedErr) { setError('שגיאה בשמירת הלוח זמנים'); return }
        }
      }

      navigate('/admin/chores')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg" dir="rtl">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/chores">← חזרה</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isEditMode ? 'עריכת משימה' : 'משימה חדשה'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="title">שם המשימה</Label>
              <Input
                id="title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="description">תיאור</Label>
              <Textarea
                id="description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="coinValue">ערך במטבעות</Label>
              <Input
                id="coinValue"
                type="number"
                min={1}
                value={coinValue}
                onChange={e => setCoinValue(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label>רמת קושי</Label>
              <Select value={difficulty} onValueChange={v => setDifficulty(v as ChoreDifficulty)}>
                <SelectTrigger aria-label="רמת קושי">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">קל</SelectItem>
                  <SelectItem value="medium">בינוני</SelectItem>
                  <SelectItem value="hard">קשה</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {recurrenceType === 'none' && (
              <div className="space-y-1">
                <Label>שייך ל</Label>
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger aria-label="שייך ל">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">מאגר משימות פתוח (כולם)</SelectItem>
                    {members.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="dueDate">תאריך יעד (אופציונלי)</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>חזרה</Label>
              <Select value={recurrenceType} onValueChange={v => setRecurrenceType(v as RecurrenceType)}>
                <SelectTrigger aria-label="סוג חזרה">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">ללא</SelectItem>
                  <SelectItem value="daily">יומי</SelectItem>
                  <SelectItem value="weekly">שבועי</SelectItem>
                  <SelectItem value="monthly">חודשי</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {recurrenceType === 'daily' && (
              <div className="space-y-3">
                <Label>תזמון יומי</Label>
                {members.map(m => (
                  <div key={m.id} className="space-y-1">
                    <p className="text-sm font-medium">{m.name}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 pr-2">
                      {DAY_NAMES.map((dayName, dayIndex) => {
                        const checked = (dailySchedule[m.id] ?? []).includes(dayIndex)
                        return (
                          <label key={dayIndex} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              aria-label={`${m.name} — ${dayName}`}
                              checked={checked}
                              onChange={e => {
                                setDailySchedule(prev => {
                                  const current = prev[m.id] ?? []
                                  return {
                                    ...prev,
                                    [m.id]: e.target.checked
                                      ? [...current, dayIndex]
                                      : current.filter(d => d !== dayIndex),
                                  }
                                })
                              }}
                              className="h-4 w-4 rounded border-input"
                            />
                            <span className="text-xs">{dayName}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(recurrenceType === 'weekly' || recurrenceType === 'monthly') && (
              <div className="space-y-2">
                <Label>משוייך ל</Label>
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`assignee-${m.id}`}
                      checked={weeklyAssignees.includes(m.id)}
                      onChange={e => {
                        if (e.target.checked) {
                          setWeeklyAssignees(prev => [...prev, m.id])
                        } else {
                          setWeeklyAssignees(prev => prev.filter(uid => uid !== m.id))
                        }
                      }}
                      className="h-4 w-4 rounded border-input"
                    />
                    <Label htmlFor={`assignee-${m.id}`}>{m.name}</Label>
                  </div>
                ))}
              </div>
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'שומר...' : 'שמור'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
