import { useRef, useState } from 'react'
import imageCompression from 'browser-image-compression'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import type { Family } from '../../types/database'

interface FamilyAvatarUploadProps {
  family: Family
  onUploaded?: (url: string) => void
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES     = 5 * 1024 * 1024 // 5 MB

export default function FamilyAvatarUpload({ family, onUploaded }: FamilyAvatarUploadProps) {
  const inputRef                  = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)

    if (!ALLOWED_TYPES.has(file.type)) {
      setError('סוג קובץ לא נתמך — יש להעלות תמונה בפורמט JPG, PNG או WebP')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('הקובץ גדול מדי — הגודל המרבי הוא 5MB')
      return
    }

    setUploading(true)
    try {
      const compressed = await imageCompression(file, { maxSizeMB: 0.5, useWebWorker: true })
      const path       = `${family.id}/avatar.jpg`

      const { error: uploadError } = await supabase.storage
        .from('family-avatars')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('family-avatars')
        .getPublicUrl(path)

      const { error: dbError } = await supabase
        .from('families')
        .update({ avatar_url: publicUrl })
        .eq('id', family.id)
      if (dbError) throw dbError

      onUploaded?.(publicUrl)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar
        className="h-16 w-16 cursor-pointer"
        onClick={() => inputRef.current?.click()}
      >
        <AvatarImage src={family.avatar_url ?? undefined} />
        <AvatarFallback>{family.name[0]}</AvatarFallback>
      </Avatar>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
        aria-label="העלה תמונת משפחה"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? 'מעלה...' : 'שנה תמונה'}
      </Button>
      {error && <p role="alert" className="text-xs text-destructive text-center">{error}</p>}
    </div>
  )
}
