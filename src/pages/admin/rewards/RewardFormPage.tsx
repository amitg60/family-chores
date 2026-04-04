import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Textarea } from '../../../components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import type { RewardType, RewardStatus } from '../../../types/database'

export default function RewardFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id !== undefined
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coinCost, setCoinCost] = useState('10')
  const [stock, setStock] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isEditMode) return
    supabase
      .from('rewards')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) { setError('שגיאה בטעינת הפרס'); return }
        if (!data) return
        setTitle(data.title)
        setDescription(data.description ?? '')
        setCoinCost(String(data.coin_cost))
        setStock(data.stock !== null ? String(data.stock) : '')
      })
  }, [id, isEditMode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      if (!profile?.family_id) {
        setError('שגיאה בשמירת הפרס')
        setSaving(false)
        return
      }

      const payload = {
        title,
        description: description || null,
        coin_cost: Number(coinCost),
        stock: stock !== '' ? Number(stock) : null,
      }

      let err: { message: string } | null = null

      if (isEditMode) {
        const result = await supabase.from('rewards').update(payload).eq('id', id!)
        err = result.error
      } else {
        const result = await supabase.from('rewards').insert({
          ...payload,
          family_id: profile.family_id,
          type: 'store' as RewardType,
          status: 'active' as RewardStatus,
        })
        err = result.error
      }

      if (err) {
        setError('שגיאה בשמירת הפרס')
      } else {
        navigate('/admin/rewards')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg" dir="rtl">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/rewards">← חזרה</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isEditMode ? 'עריכת פרס' : 'פרס חדש'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="title">שם הפרס</Label>
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
              <Label htmlFor="coinCost">עלות במטבעות</Label>
              <Input
                id="coinCost"
                type="number"
                min={1}
                value={coinCost}
                onChange={e => setCoinCost(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="stock">מלאי (ריק = ללא הגבלה)</Label>
              <Input
                id="stock"
                type="number"
                min={0}
                value={stock}
                onChange={e => setStock(e.target.value)}
                placeholder="ללא הגבלה"
              />
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
