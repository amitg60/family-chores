import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

export default function SignupPage() {
  const navigate = useNavigate()
  const [familyName, setFamilyName] = useState('')
  const [teamName, setTeamName]     = useState('')
  const [adminName, setAdminName]   = useState('')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [emailSent, setEmailSent]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError || !data.user) {
      setError(signUpError?.message ?? 'שגיאה ביצירת החשבון')
      setLoading(false)
      return
    }

    const { error: rpcError } = await supabase.rpc('create_family_and_admin', {
      p_family_name: familyName,
      p_team_name:   teamName,
      p_admin_name:  adminName,
      p_user_id:     data.user.id,
    })
    if (rpcError) {
      setError(rpcError.message)
      setLoading(false)
      return
    }

    if (data.session) {
      navigate('/admin')
    } else {
      setEmailSent(true)
    }
    setLoading(false)
  }

  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-2xl">📧</p>
            <p className="font-semibold text-lg">בדוק את תיבת הדואר שלך</p>
            <p className="text-sm text-muted-foreground">
              שלחנו קישור אימות לכתובת <span className="font-medium">{email}</span>.
              לאחר האישור תוכל להתחבר.
            </p>
            <p className="text-xs text-muted-foreground">
              לא קיבלת? בדוק גם את תיקיית הספאם.
            </p>
            <Link to="/login" className="block text-sm underline text-muted-foreground pt-2">
              לדף הכניסה
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl">יצירת משפחה חדשה</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              placeholder="שם המשפחה (למשל: משפחת כהן)"
              value={familyName}
              onChange={e => setFamilyName(e.target.value)}
              required
              aria-label="שם המשפחה"
            />
            <Input
              placeholder="כינוי המשפחה — אופציונלי (למשל: כהן השולטים)"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              aria-label="כינוי המשפחה"
            />
            <Input
              placeholder="השם שלך"
              value={adminName}
              onChange={e => setAdminName(e.target.value)}
              required
              aria-label="השם שלך"
            />
            <Input
              type="email"
              placeholder="אימייל"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              aria-label="אימייל"
            />
            <Input
              type="password"
              placeholder="סיסמה"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              aria-label="סיסמה"
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'יוצר...' : 'צור משפחה'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              כבר יש לך חשבון?{' '}
              <Link to="/login" className="underline">כניסה</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
