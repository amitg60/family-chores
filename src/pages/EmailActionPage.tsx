import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string

type PageState =
  | { kind: 'loading' }
  | { kind: 'success'; action: 'approve' | 'reject' }
  | { kind: 'already_actioned' }
  | { kind: 'error' }

export default function EmailActionPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [state, setState] = useState<PageState>({ kind: 'loading' })

  useEffect(() => {
    if (!token) { setState({ kind: 'error' }); return }

    const apiUrl = `${supabaseUrl}/functions/v1/handle-completion-action?token=${encodeURIComponent(token)}`

    fetch(apiUrl, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const action = data.action === 'approve' || data.action === 'reject' ? data.action : 'approve'
          setState({ kind: 'success', action })
        } else if (data.error === 'already_actioned') {
          setState({ kind: 'already_actioned' })
        } else {
          setState({ kind: 'error' })
        }
      })
      .catch(() => setState({ kind: 'error' }))
  }, [token])

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-xl shadow-sm p-8 max-w-sm w-full text-right">
        {state.kind === 'loading' && (
          <p className="text-gray-500 text-lg">מבצע פעולה...</p>
        )}

        {state.kind === 'success' && (
          <p className="text-lg text-gray-700">
            {state.action === 'approve'
              ? '✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות.'
              : '❌ ההגשה נדחתה.'}
          </p>
        )}

        {state.kind === 'already_actioned' && (
          <p className="text-lg text-gray-700">ℹ️ הגשה זו כבר טופלה.</p>
        )}

        {state.kind === 'error' && (
          <p className="text-lg text-gray-700">⚠️ לא ניתן לבצע את הפעולה. ייתכן שהקישור פג תוקפו.</p>
        )}
      </div>
    </div>
  )
}
