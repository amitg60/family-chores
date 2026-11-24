import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

const MIN_LENGTH = 6 // matches Supabase auth minimum_password_length

// The recovery email link lands here; supabase-js reads the token from the URL
// and signs the user in, so a session means the link was valid.
export default function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_LENGTH) { setError(`הסיסמה צריכה לפחות ${MIN_LENGTH} תווים`); return }
    if (password !== confirm) { setError('הסיסמאות לא תואמות'); return }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) { setError('עדכון הסיסמה נכשל. בקשו קישור חדש.'); return }
      navigate('/', { replace: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">סיסמה חדשה</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p role="status" className="text-center text-muted-foreground">טוען...</p>
          ) : !session ? (
            <div className="space-y-4 text-center">
              <p role="alert">הקישור לא תקין או שפג תוקפו.</p>
              <Link to="/forgot-password" className="underline text-sm">בקשו קישור חדש</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="password">סיסמה חדשה</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={MIN_LENGTH}
                  autoComplete="new-password"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm">אימות סיסמה</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  dir="ltr"
                />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? 'שומר...' : 'שמירת סיסמה'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
