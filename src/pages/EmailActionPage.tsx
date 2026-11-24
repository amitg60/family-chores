import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string

type Action = 'approve' | 'reject'
type PageState =
  | { kind: 'loading' }
  | { kind: 'confirm'; action: Action }
  | { kind: 'submitting'; action: Action }
  | { kind: 'success'; action: Action }
  | { kind: 'already_actioned' }
  | { kind: 'error' }

const asAction = (a: unknown): Action | null => (a === 'approve' || a === 'reject' ? a : null)

// Opening the link only checks status (GET). The approve/reject (POST) runs on
// a click, so mail scanners that open links can't act on the parent's behalf.
export default function EmailActionPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [state, setState] = useState<PageState>(token ? { kind: 'loading' } : { kind: 'error' })
  const apiUrl = `${supabaseUrl}/functions/v1/handle-completion-action?token=${encodeURIComponent(token ?? '')}`

  useEffect(() => {
    if (!token) return
    fetch(apiUrl)
      .then(r => r.json())
      .then(data => {
        const action = asAction(data.action)
        if (data.status === 'pending' && action) setState({ kind: 'confirm', action })
        else if (data.status === 'already_actioned') setState({ kind: 'already_actioned' })
        else setState({ kind: 'error' })
      })
      .catch(() => setState({ kind: 'error' }))
  }, [token, apiUrl])

  function confirm(action: Action) {
    setState({ kind: 'submitting', action })
    fetch(apiUrl, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.success) setState({ kind: 'success', action: asAction(data.action) ?? action })
        else if (data.error === 'already_actioned') setState({ kind: 'already_actioned' })
        else setState({ kind: 'error' })
      })
      .catch(() => setState({ kind: 'error' }))
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-xl shadow-sm p-8 max-w-sm w-full text-right">
        {state.kind === 'loading' && (
          <p role="status" className="text-gray-500 text-lg">בודק את ההגשה...</p>
        )}

        {(state.kind === 'confirm' || state.kind === 'submitting') && (
          <div className="space-y-4">
            <p className="text-lg text-gray-700">
              {state.action === 'approve' ? 'לאשר את ההגשה? השחקן יקבל את המטבעות.' : 'לדחות את ההגשה?'}
            </p>
            <button
              type="button"
              onClick={() => confirm(state.action)}
              disabled={state.kind === 'submitting'}
              className={`w-full rounded-lg py-3 font-bold text-white disabled:opacity-60 ${
                state.action === 'approve' ? 'bg-green-500' : 'bg-red-500'
              }`}
            >
              {state.kind === 'submitting' ? 'מבצע...' : state.action === 'approve' ? '✅ אשר' : '❌ דחה'}
            </button>
          </div>
        )}

        {state.kind === 'success' && (
          <p role="status" className="text-lg text-gray-700">
            {state.action === 'approve'
              ? '✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות.'
              : '❌ ההגשה נדחתה.'}
          </p>
        )}

        {state.kind === 'already_actioned' && (
          <p className="text-lg text-gray-700">ℹ️ הגשה זו כבר טופלה.</p>
        )}

        {state.kind === 'error' && (
          <p role="alert" className="text-lg text-gray-700">⚠️ לא ניתן לבצע את הפעולה. ייתכן שהקישור פג תוקפו.</p>
        )}
      </div>
    </div>
  )
}
