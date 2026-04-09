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

export default function ChoreFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id !== undefined
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { members } = useFamilyMembers()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coinValue, setCoinValue] = useState('1')
  const [difficulty, setDifficulty] = useState<ChoreDifficulty>('easy')
  const [assignedTo, setAssignedTo] = useState('none')
  const [dueDate, setDueDate] = useState('')
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isEditMode) return
    supabase
      .from('chores')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setError('שגיאה בטעינת המשימה')
          return
        }
        if (!data) return
        setTitle(data.title)
        setDescription(data.description ?? '')
        setCoinValue(String(data.coin_value))
        setDifficulty(data.difficulty as ChoreDifficulty)
        setAssignedTo(data.assigned_to ?? 'none')
        setDueDate(data.due_date ?? '')
        setRecurrenceType(data.recurrence_type as RecurrenceType)
      })
  }, [id, isEditMode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const payload = {
        title,
        description: description || null,
        coin_value: Number(coinValue),
        difficulty,
        assigned_to: assignedTo === 'none' ? null : assignedTo,
        due_date: dueDate || null,
        recurrence_type: recurrenceType,
      }

      if (!profile?.family_id) {
        setError('שגיאה בשמירת המשימה')
        setSaving(false)
        return
      }

      let err: { message: string } | null = null

      if (isEditMode) {
        const result = await supabase.from('chores').update(payload).eq('id', id!)
        err = result.error
      } else {
        const result = await supabase.from('chores').insert({
          ...payload,
          family_id: profile.family_id,
          status: 'active' as ChoreStatus,
        })
        err = result.error
      }

      if (err) {
        setError('שגיאה בשמירת המשימה')
      } else {
        navigate('/admin/chores')
      }
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

            <div className="space-y-1">
              <Label>שייך ל</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger aria-label="שייך ל">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">בריכה פתוחה (כולם)</SelectItem>
                  {members.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="dueDate">תאריך יעד (אופציונלי)</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="isRecurring"
                type="checkbox"
                checked={recurrenceType !== 'none'}
                onChange={e => setRecurrenceType(e.target.checked ? 'weekly' : 'none')}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="isRecurring">משימה שבועית חוזרת</Label>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'שומר...' : 'שמור'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
