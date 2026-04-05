import { useState, useCallback } from 'react'
import { useFeedback } from '../../../hooks/useFeedback'
import type { FeedbackWithProfile } from '../../../hooks/useFeedback'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import type { FeedbackCategory, FeedbackMood } from '../../../types/database'

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: 'באג',
  improvement: 'רעיון לשיפור',
  love: 'משהו שאני אוהב',
  bothers: 'משהו שמפריע לי',
}

const MOOD_EMOJI: Record<FeedbackMood, string> = {
  happy: '😊',
  neutral: '😐',
  frustrated: '😤',
}

export default function FeedbackDashboard() {
  const { feedback, loading, error, refetch } = useFeedback()
  const [actionError, setActionError] = useState<string | null>(null)

  const markNoted = useCallback(async (id: string) => {
    const { error } = await supabase.from('feedback').update({ noted: true }).eq('id', id)
    if (!error) refetch()
    else setActionError('שגיאה בעדכון. נסה שנית.')
  }, [refetch])

  const markResolved = useCallback(async (id: string) => {
    const { error } = await supabase.from('feedback').update({ resolved: true }).eq('id', id)
    if (!error) refetch()
    else setActionError('שגיאה בעדכון. נסה שנית.')
  }, [refetch])

  const avgRating = feedback.length > 0
    ? (feedback.reduce((s, f) => s + f.star_rating, 0) / feedback.length).toFixed(1)
    : null

  const moodCounts = feedback.reduce(
    (acc, f) => { acc[f.mood] = (acc[f.mood] ?? 0) + 1; return acc },
    {} as Record<string, number>
  )

  const categoryCounts = feedback.reduce(
    (acc, f) => { acc[f.category] = (acc[f.category] ?? 0) + 1; return acc },
    {} as Record<FeedbackCategory, number>
  )

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">משוב</h1>

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : feedback.length === 0 ? (
        <p role="status" className="text-muted-foreground">אין משוב עדיין.</p>
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">דירוג ממוצע</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold"><span aria-hidden="true">⭐</span> {avgRating}</p>
                <p className="text-xs text-muted-foreground">{feedback.length} תגובות</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">מצב רוח</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {(['happy', 'neutral', 'frustrated'] as const).map(m => (
                  <div key={m} className="flex items-center gap-2">
                    <span>{MOOD_EMOJI[m]} {moodCounts[m] ?? 0}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">קטגוריות</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {(Object.keys(CATEGORY_LABEL) as FeedbackCategory[]).map(cat => (
                  categoryCounts[cat]
                    ? <div key={cat}>{CATEGORY_LABEL[cat]}: {categoryCounts[cat]}</div>
                    : null
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Feedback list */}
          <div className="space-y-3">
            {feedback.map((f) => (
              <Card key={f.id}>
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{f.profiles.name}</span>
                        <Badge variant="secondary">{CATEGORY_LABEL[f.category]}</Badge>
                        <span>{MOOD_EMOJI[f.mood]}</span>
                        <span className="text-sm" aria-label={`${f.star_rating} כוכבים`}>{'★'.repeat(f.star_rating)}</span>
                        {f.noted && <Badge variant="outline">נלקח בחשבון</Badge>}
                        {f.resolved && <Badge variant="outline">טופל</Badge>}
                      </div>
                      {f.areas.length > 0 && (
                        <p className="text-xs text-muted-foreground">{f.areas.join(' · ')}</p>
                      )}
                      {f.free_text && (
                        <p className="text-sm text-muted-foreground italic">"{f.free_text}"</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {!f.noted && (
                        <Button size="sm" variant="outline" onClick={() => markNoted(f.id)}>
                          סמן כנלקח בחשבון
                        </Button>
                      )}
                      {!f.resolved && (
                        <Button size="sm" variant="outline" onClick={() => markResolved(f.id)}>
                          סמן כטופל
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleDateString('he-IL')}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          {actionError && (
            <p role="alert" className="text-sm text-destructive">{actionError}</p>
          )}
        </>
      )}
    </div>
  )
}
