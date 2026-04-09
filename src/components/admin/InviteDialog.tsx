import { useState } from 'react'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import type { UserRole } from '../../types/database'

interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  generateInvite: (role: UserRole) => Promise<string>
}

export default function InviteDialog({ open, onOpenChange, generateInvite }: InviteDialogProps) {
  const [step, setStep]                 = useState<'role' | 'link'>('role')
  const [selectedRole, setSelectedRole] = useState<UserRole>('player')
  const [inviteUrl, setInviteUrl]       = useState('')
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [copied, setCopied]             = useState(false)

  function reset() {
    setStep('role')
    setSelectedRole('player')
    setInviteUrl('')
    setError(null)
    setCopied(false)
  }

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const token  = await generateInvite(selectedRole)
      const appUrl = (import.meta.env.VITE_APP_URL as string | undefined) ?? window.location.origin
      setInviteUrl(`${appUrl}/join?token=${token}`)
      setStep('link')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) reset(); onOpenChange(open) }}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>הזמן בן משפחה</DialogTitle>
        </DialogHeader>

        {step === 'role' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {(['player', 'admin'] as UserRole[]).map(role => (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  className={`p-3 rounded-lg border-2 text-center transition-colors ${
                    selectedRole === role ? 'border-primary bg-primary/10' : 'border-muted'
                  }`}
                >
                  <p className="font-medium">{role === 'player' ? 'שחקן' : 'מנהל משותף'}</p>
                  <p className="text-xs text-muted-foreground">{role === 'player' ? 'ילד' : 'הורה'}</p>
                </button>
              ))}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={handleGenerate} disabled={loading}>
              {loading ? 'יוצר קישור...' : 'צור קישור'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <QRCode value={inviteUrl} size={160} />
            </div>
            <p className="text-xs text-muted-foreground text-center">הקישור תקף ל-5 שעות</p>
            <Button variant="outline" className="w-full" onClick={handleCopy} aria-label="העתק קישור">
              {copied ? 'הועתק!' : 'העתק קישור'}
            </Button>
            <Button variant="ghost" className="w-full" onClick={reset}>
              צור קישור חדש
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
