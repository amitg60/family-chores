// supabase/functions/handle-completion-action/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function toB64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

async function validateToken(
  token: string,
  secret: string
): Promise<{ completionId: string; action: string; adminId: string } | null> {
  try {
    const [payloadB64url, sigB64url] = token.split('.')
    if (!payloadB64url || !sigB64url) return null
    const enc = new TextEncoder()
    const payloadBytes = fromB64url(payloadB64url)
    const payload = new TextDecoder().decode(payloadBytes)
    const [completionId, action, adminId, expiryStr] = payload.split(':')
    if (!completionId || !action || !adminId || !expiryStr) return null
    if (action !== 'approve' && action !== 'reject') return null
    if (Math.floor(Date.now() / 1000) > parseInt(expiryStr, 10)) return null
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const valid = await crypto.subtle.verify(
      'HMAC', key, fromB64url(sigB64url), enc.encode(payload)
    )
    if (!valid) return null
    return { completionId, action, adminId }
  } catch {
    return null
  }
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(new Blob([html], { type: 'text/html; charset=utf-8' }), {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

const PLAIN_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8' }

function htmlPage(body: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ביצוע פעולה</title>
</head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:32px;max-width:480px;margin:40px auto;">
  ${body}
</body>
</html>`
}

function terminalPage(appUrl: string): Response {
  const link = appUrl
    ? `<a href="${appUrl}" style="color:#6366f1;text-decoration:underline;">פתח את האפליקציה</a>`
    : 'אנא פתח את האפליקציה'
  return htmlResponse(htmlPage(`<p style="font-size:1.2rem;color:#374151;">⚠️ לא ניתן לבצע את הפעולה. ${link}</p>`))
}

function alreadyActionedPage(): Response {
  return htmlResponse(htmlPage(`<p style="font-size:1.2rem;color:#374151;">ℹ️ הגשה זו כבר טופלה.</p>`))
}

function confirmationPage(token: string, action: string): Response {
  const isApprove = action === 'approve'
  const heading = isApprove
    ? 'אתה עומד לאשר את ההגשה.'
    : 'אתה עומד לדחות את ההגשה.'
  const btnLabel = isApprove ? 'אשר' : 'דחה'
  const btnColor = isApprove ? '#22c55e' : '#ef4444'
  const encodedToken = encodeURIComponent(token)
  return htmlResponse(htmlPage(`
      <h2 style="color:#1e1b4b;margin:0 0 24px 0;">${heading}</h2>
      <button id="btn" onclick="confirm()"
              style="background:${btnColor};color:white;padding:14px 28px;border:none;border-radius:8px;font-size:1.1rem;font-weight:bold;cursor:pointer;min-height:44px;min-width:44px;">
        ${btnLabel}
      </button>
      <script>
        async function confirm() {
          const btn = document.getElementById('btn');
          btn.disabled = true;
          const res = await fetch('?token=${encodedToken}', { method: 'POST' });
          const html = await res.text();
          document.open(); document.write(html); document.close();
        }
      </script>
    `))
}

function successPage(action: string): Response {
  const msg = action === 'approve'
    ? '✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות.'
    : '❌ ההגשה נדחתה.'
  return htmlResponse(htmlPage(`<p style="font-size:1.2rem;color:#374151;">${msg}</p>`))
}

Deno.serve(async (req) => {
  console.log(`[DEBUG] method=${req.method}`)
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return new Response('missing token', { status: 400, headers: PLAIN_HEADERS })
  }

  const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const appUrl = Deno.env.get('APP_URL') ?? ''

  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('[INFRA] missing env: WEBHOOK_SECRET or SUPABASE_SERVICE_ROLE_KEY')
    return terminalPage(appUrl)
  }

  const parsed = await validateToken(token, webhookSecret)
  console.log(`[DEBUG] token_len=${token.length} secret_len=${webhookSecret.length} parsed=${parsed !== null}`)
  if (!parsed) {
    return terminalPage(appUrl)
  }
  const { completionId, action, adminId } = parsed

  let supabase
  try {
    supabase = createClient(supabaseUrl, supabaseServiceKey)
  } catch (err) {
    console.error(`[INFRA] completionId=${completionId} intended_recipient_id=${adminId} client creation failed: ${err}`)
    return terminalPage(appUrl)
  }

  if (req.method === 'GET') {
    const { data: completion, error: statusError } = await supabase
      .from('chore_completions')
      .select('status')
      .eq('id', completionId)
      .single()

    if (statusError) {
      console.error(`[INFRA] completionId=${completionId} intended_recipient_id=${adminId} status check failed: ${statusError.message}`)
      return terminalPage(appUrl)
    }

    if (!completion || completion.status !== 'pending') {
      return alreadyActionedPage()
    }

    return confirmationPage(token, action)
  }

  if (req.method === 'POST') {
    console.log(`[EMAIL-ACTION] completionId=${completionId} action=${action} intended_recipient_id=${adminId}`)

    const rpcName = action === 'approve' ? 'email_approve_completion' : 'email_reject_completion'
    const rpcArgs = action === 'approve'
      ? { p_completion_id: completionId, p_admin_id: adminId }
      : { p_completion_id: completionId, p_admin_id: adminId, p_reason: 'נדחה על ידי המנהל' }

    const { error: rpcError } = await supabase.rpc(rpcName, rpcArgs)

    if (rpcError) {
      if (rpcError.message.includes('not pending')) {
        return alreadyActionedPage()
      }
      console.error(`[INFRA] completionId=${completionId} intended_recipient_id=${adminId} action=${action} rpc failed: ${rpcError.message}`)
      return terminalPage(appUrl)
    }

    return successPage(action)
  }

  return new Response('Method not allowed', { status: 405, headers: PLAIN_HEADERS })
})
