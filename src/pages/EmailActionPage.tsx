import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string

type PageState =
  | { kind: 'loading' }
  | { kind: 'confirm'; action: 'approve' | 'reject' }
  | { kind: 'submitting' }
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
    fetch(apiUrl)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'pending' && (data.action === 'approve' || data.action === 'reject')) {
          setState({ kind: 'confirm', action: data.action })
        } else if (data.status === 'already_actioned') {
          setState({ kind: 'already_actioned' })
        } else {
          setState({ kind: 'error' })
        }
      })
      .catch(() => setState({ kind: 'error' }))
  }, [token])

  async function handleConfirm() {
    if (!token || state.kind !== 'confirm') return
    const action = state.action
    setState({ kind: 'submitting' })
    try {
      const apiUrl = `${supabaseUrl}/functions/v1/handle-completion-action?token=${encodeURIComponent(token)}`
      const res = await fetch(apiUrl, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setState({ kind: 'success', action })
      } else if (data.error === 'already_actioned') {
        setState({ kind: 'already_actioned' })
      } else {
        setState({ kind: 'error' })
      }
    } catch {
      setState({ kind: 'error' })
    }
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-xl shadow-sm p-8 max-w-sm w-full text-right">
        {state.kind === 'loading' && (
          <p className="text-gray-500 text-lg">טוען...</p>
        )}

        {state.kind === 'confirm' && (
          <>
            <h1 className="text-xl font-bold text-indigo-900 mb-6">
              {state.action === 'approve'
                ? 'אתה עומד לאשר את ההגשה.'
                : 'אתה עומד לדחות את ההגשה.'}
            </h1>
            <button
              onClick={handleConfirm}
              className={`w-full py-3 px-6 rounded-lg text-white font-bold text-lg ${
                state.action === 'approve'
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-red-500 hover:bg-red-600'
              }`}
            >
              {state.action === 'approve' ? 'אשר' : 'דחה'}
            </button>
          </>
        )}

        {state.kind === 'submitting' && (
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
          <p className="text-lg text-gray-700">⚠️ לא ניתן לבצע את הפעולה.</p>
        )}
      </div>
    </div>
  )
}
