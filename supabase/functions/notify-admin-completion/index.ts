// supabase/functions/notify-admin-completion/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toB64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generateToken(
  completionId: string,
  action: 'approve' | 'reject',
  adminId: string,
  secret: string
): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  const payload = `${completionId}:${action}:${adminId}:${expiry}`
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toB64url(enc.encode(payload)) + '.' + toB64url(new Uint8Array(sig))
}

function buildAdminEmail(
  playerName: string,
  choreTitle: string,
  coinValue: number,
  approveUrl: string,
  rejectUrl: string,
  photoSignedUrl: string | null
): string {
  const photoBlock = photoSignedUrl ? `
  <img src="${escapeHtml(photoSignedUrl)}"
       alt="תמונת הוכחה שצולמה על ידי השחקן"
       width="400"
       border="0"
       style="display:block;border:0;outline:none;text-decoration:none;max-width:100%;border-radius:8px;margin:16px 0;">
  <p style="font-size:12px;color:#6b7280;margin:0 0 16px 0;">תמונת הוכחה לביצוע המשימה</p>` : ''

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="color:#1e1b4b;margin:0 0 12px 0;">📋 ${escapeHtml(playerName)} השלים/ה משימה</h2>
  <p style="margin:0 0 8px 0;">${escapeHtml(playerName)} השלים/ה את המשימה ״<strong>${escapeHtml(choreTitle)}</strong>״ ומחכה לאישורך.</p>
  <p style="margin:0 0 16px 0;">ערך המשימה: <strong>${coinValue} מטבעות</strong></p>
  ${photoBlock}
  <div style="margin-top:24px;">
    <a href="${escapeHtml(approveUrl)}"
       style="display:inline-block;background:#22c55e;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin-left:12px;font-size:1rem;">
      ✅ אשר
    </a>
    <a href="${escapeHtml(rejectUrl)}"
       style="display:inline-block;background:#ef4444;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:1rem;">
      ❌ דחה
    </a>
  </div>
</body>
</html>`
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const webhookSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!timingSafeEqual(webhookSecret, Deno.env.get('WEBHOOK_SECRET') ?? '')) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const record = (payload as Record<string, unknown>).record as Record<string, unknown> | null
  if (
    !record ||
    typeof record.id !== 'string' || !record.id ||
    typeof record.completed_by !== 'string' ||
    typeof record.chore_assignment_id !== 'string'
  ) {
    return new Response('Invalid webhook payload', { status: 400 })
  }

  const completionId = record.id
  const photoUrl = typeof record.photo_url === 'string' ? record.photo_url : null

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('FROM_EMAIL')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const webhookSecretValue = Deno.env.get('WEBHOOK_SECRET')

  if (!resendApiKey || !fromEmail || !supabaseUrl || !supabaseServiceKey || !webhookSecretValue) {
    console.error('Missing required env vars')
    return new Response('Server misconfiguration', { status: 500 })
  }

  const actionBaseUrl = `${supabaseUrl}/functions/v1/handle-completion-action`
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name, family_id')
    .eq('id', record.completed_by)
    .single()

  if (profileError || !profile) {
    console.error('Profile query failed:', profileError)
    return new Response('Profile not found', { status: 404 })
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('chore_assignments')
    .select('chores(title, coin_value)')
    .eq('id', record.chore_assignment_id)
    .single()

  if (assignmentError) {
    // Non-fatal: email sends with placeholder if assignment lookup fails
    console.error('Assignment query failed:', assignmentError)
  }

  const chore = assignment?.chores as { title: string; coin_value: number } | null | undefined

  // Generate photo signed URL with same 7-day TTL as action tokens
  let photoSignedUrl: string | null = null
  if (photoUrl) {
    const { data: signedData } = await supabase.storage
      .from('completion-photos')
      .createSignedUrl(photoUrl, 7 * 24 * 60 * 60)
    photoSignedUrl = signedData?.signedUrl ?? null
  }

  const { data: admins, error: adminsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('family_id', profile.family_id)
    .eq('role', 'admin')

  if (adminsError) {
    console.error('Admins query failed:', adminsError)
    return new Response('Failed to fetch admins', { status: 500 })
  }

  await Promise.all(
    (admins ?? []).map(async (admin) => {
      try {
        const { data: authData, error: authError } = await supabase.auth.admin.getUserById(admin.id)
        if (authError || !authData?.user?.email) return
        const adminEmail = authData.user.email

        // Each admin gets unique tokens embedding their profile ID
        const [approveToken, rejectToken] = await Promise.all([
          generateToken(completionId, 'approve', admin.id, webhookSecretValue),
          generateToken(completionId, 'reject', admin.id, webhookSecretValue),
        ])
        const approveUrl = `${actionBaseUrl}?token=${approveToken}`
        const rejectUrl = `${actionBaseUrl}?token=${rejectToken}`

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: adminEmail,
            subject: `📋 ${profile.name} השלים/ה את המשימה ״${chore?.title ?? 'משימה'}״`,
            html: buildAdminEmail(
              profile.name,
              chore?.title ?? 'משימה',
              chore?.coin_value ?? 0,
              approveUrl,
              rejectUrl,
              photoSignedUrl
            ),
          }),
        })

        if (!res.ok) {
          const body = await res.text()
          console.error(`Resend error for ${adminEmail}: ${res.status} ${body}`)
        } else {
          console.log(`Admin notification sent to ${adminEmail}`)
        }
      } catch (err) {
        console.error(`Failed to notify admin ${admin.id}:`, err)
      }
    })
  )

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
