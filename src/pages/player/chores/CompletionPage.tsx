import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { compressPhoto } from '../../../lib/photoUtils'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'

export default function CompletionPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const previewUrlRef = useRef<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('יש לבחור קובץ תמונה')
      return
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    const url = URL.createObjectURL(file)
    previewUrlRef.current = url
    setSelectedFile(file)
    setPreview(url)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile || !profile || !assignmentId) return
    setError(null)
    setSubmitting(true)
    try {
      const compressed = await compressPhoto(selectedFile)
      const filePath = `${profile.id}/${crypto.randomUUID()}.webp`

      const { error: uploadError } = await supabase.storage
        .from('completion-photos')
        .upload(filePath, compressed)
      if (uploadError) { setError('שגיאה בהעלאת התמונה'); return }

      const { data: completion, error: insertError } = await supabase
        .from('chore_completions')
        .insert({
          chore_assignment_id: assignmentId,
          completed_by: profile.id,
          photo_url: filePath,
          status: 'pending',
        })
        .select('id')
        .single()
      if (insertError || !completion) { setError('שגיאה בשמירת ההשלמה'); return }

      if ((profile.trust_level ?? 1) >= 4) {
        const { error: rpcError } = await supabase.rpc('approve_completion', {
          completion_id: completion.id,
        })
        if (rpcError) { setError('שגיאה בקבלת המטבעות'); return }
        // Best-effort: DB already has photo_url = null via RPC; cron covers any orphan
        await supabase.storage.from('completion-photos').remove([filePath])
      }

      navigate('/player')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-lg" dir="rtl">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/player">← חזרה</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>הגשת הוכחת ביצוע</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="photo" className="text-sm font-medium">
                תמונת הוכחה
              </label>
              <input
                id="photo"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="block w-full text-sm"
              />
            </div>

            {preview && (
              <img
                src={preview}
                alt="תצוגה מקדימה"
                className="w-full max-h-64 object-cover rounded"
              />
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={submitting || !selectedFile}>
              {submitting ? 'שולח...' : 'שלח הוכחה'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
