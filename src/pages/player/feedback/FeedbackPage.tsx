import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Textarea } from '../../../components/ui/textarea'
import { Label } from '../../../components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import type { FeedbackCategory, FeedbackMood } from '../../../types/database'

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'באג' },
  { value: 'improvement', label: 'רעיון לשיפור' },
  { value: 'love', label: 'משהו שאני אוהב' },
  { value: 'bothers', label: 'משהו שמפריע לי' },
]

const AREAS: { value: string; label: string }[] = [
  { value: 'chores', label: 'משימות' },
  { value: 'store', label: 'חנות' },
  { value: 'barter', label: 'שוק חליפין' },
  { value: 'calendar', label: 'לוח שבועי' },
  { value: 'achievements', label: 'הישגים' },
  { value: 'general', label: 'כללי' },
]

const MOODS: { value: FeedbackMood; emoji: string; label: string }[] = [
  { value: 'happy', emoji: '😊', label: 'שמח' },
  { value: 'neutral', emoji: '😐', label: 'נייטרלי' },
  { value: 'frustrated', emoji: '😤', label: 'מתוסכל' },
]

export default function FeedbackPage() {
  const { profile } = useAuth()

  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [areas, setAreas] = useState<string[]>([])
  const [starRating, setStarRating] = useState(0)
  const [mood, setMood] = useState<FeedbackMood | null>(null)
  const [freeText, setFreeText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function toggleArea(value: string) {
    setAreas(prev =>
      prev.includes(value) ? prev.filter(a => a !== value) : [...prev, value]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (starRating === 0) {
      setError('אנא בחר דירוג')
      return
    }
    if (!mood) {
      setError('אנא בחר מצב רוח')
      return
    }
    if (!profile?.family_id) {
      setError('שגיאה בשליחת המשוב')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('feedback').insert({
      user_id: profile.id,
      family_id: profile.family_id,
      category,
      areas,
      star_rating: starRating,
      mood,
      free_text: freeText || null,
      noted: false,
      resolved: false,
    })
    if (error) {
      setSubmitting(false)
      setError('שגיאה בשליחת המשוב')
    } else {
      setSubmitting(false)
      setSuccess(true)
    }
  }

  function resetForm() {
    setCategory('bug')
    setAreas([])
    setStarRating(0)
    setMood(null)
    setFreeText('')
    setError(null)
    setSuccess(false)
  }

  if (success) {
    return (
      <div className="max-w-lg space-y-4" dir="rtl">
        <Card>
          <CardContent role="status" className="py-8 text-center space-y-4">
            <p className="text-2xl">🎉</p>
            <p className="text-lg font-semibold">תודה על המשוב!</p>
            <p className="text-sm text-muted-foreground">המשוב שלך עוזר לנו לשפר את האפליקציה.</p>
            <Button onClick={resetForm}>שלח עוד משוב</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-4" dir="rtl">
      <h1 className="text-2xl font-bold">משוב</h1>

      <Card>
        <CardHeader>
          <CardTitle>שתף אותנו</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Category */}
            <div className="space-y-1">
              <Label>קטגוריה</Label>
              <Select value={category} onValueChange={v => setCategory(v as FeedbackCategory)}>
                <SelectTrigger aria-label="קטגוריה">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Areas */}
            <div className="space-y-2">
              <Label>אזור באפליקציה (ניתן לבחור כמה)</Label>
              <div className="grid grid-cols-2 gap-2">
                {AREAS.map(a => (
                  <label key={a.value} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={areas.includes(a.value)}
                      onChange={() => toggleArea(a.value)}
                      className="h-4 w-4"
                    />
                    {a.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Star rating */}
            <div className="space-y-1">
              <Label>דירוג כולל</Label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} כוכבים`}
                    aria-pressed={n <= starRating}
                    onClick={() => setStarRating(n)}
                    className={`text-2xl transition-colors ${
                      n <= starRating ? 'text-yellow-400' : 'text-muted-foreground'
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            {/* Mood */}
            <div className="space-y-1">
              <Label>מצב רוח</Label>
              <div className="flex gap-2">
                {MOODS.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    aria-label={`${m.emoji} ${m.label}`}
                    aria-pressed={mood === m.value}
                    onClick={() => setMood(m.value)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full border text-sm transition-colors ${
                      mood === m.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input hover:bg-muted'
                    }`}
                  >
                    {m.emoji} {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Free text */}
            <div className="space-y-1">
              <Label htmlFor="freeText">טקסט חופשי</Label>
              <Textarea
                id="freeText"
                placeholder="ספר לנו עוד... (אופציונלי)"
                value={freeText}
                onChange={e => setFreeText(e.target.value)}
                rows={3}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'שולח...' : 'שלח משוב'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
