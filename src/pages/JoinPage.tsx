import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

interface ValidateResult {
  valid: boolean
  family_name?: string
  team_name?: string | null
  invited_by?: string
  reason?: string
}

export default function JoinPage() {
  const navigate = useNavigate()
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [validation, setValidation]   = useState<ValidateResult | null>(null)
  const [validating, setValidating]   = useState(true)
  const [name, setName]               = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [emailSent, setEmailSent]     = useState(false)

  useEffect(() => {
    if (!token) {
      setValidation({ valid: false, reason: 'not_found' })
      setValidating(false)
      return
    }
    supabase.rpc('validate_invite_token', { p_token: token })
      .then(({ data }) => {
        setValidation(data as ValidateResult)
        setValidating(false)
      })
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + '/login' },
    })
    if (signUpError || !data.user) {
      setError(signUpError?.message ?? 'שגיאה ביצירת החשבון')
      setLoading(false)
      return
    }

    const { error: rpcError } = await supabase.rpc('redeem_invite', {
      p_token:   token,
      p_name:    name,
      p_user_id: data.user.id,
    })
    if (rpcError) {
      setError('הקישור כבר נוצל או שפג תוקפו')
      setLoading(false)
      return
    }

    if (data.session) {
      navigate('/')
    } else {
      setEmailSent(true)
    }
    setLoading(false)
  }

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <p role="status" className="text-muted-foreground">בודק קישור...</p>
      </div>
    )
  }

  if (!validation?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center">
            <p role="alert" className="text-destructive font-medium">
              הקישור אינו תקף או שפג תוקפו — בקש מהמנהל קישור חדש
            </p>
          </CardContent>
        </Card>
      </div>
    )
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
            <p className="text-xs text-muted-foreground">לא קיבלת? בדוק גם את תיקיית הספאם.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl">
            הוזמת על ידי {validation.invited_by} למשפחת {validation.family_name}
            {validation.team_name ? ` — ${validation.team_name}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              placeholder="שם מלא"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              aria-label="שם מלא"
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
              {loading ? 'מצטרף...' : 'הצטרף'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
