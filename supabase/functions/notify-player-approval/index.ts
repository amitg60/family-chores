import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildPlayerEmail(playerName: string, choreTitle: string, coinValue: number, appUrl: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="color:#1e1b4b;">🎉 הגשתך אושרה!</h2>
  <p>שלום <strong>${escapeHtml(playerName)}</strong>,</p>
  <p>המשימה ״<strong>${escapeHtml(choreTitle)}</strong>״ אושרה על ידי המנהל.</p>
  <p>זוכו לחשבונך <strong>${coinValue} מטבעות</strong>!</p>
  <a href="${escapeHtml(appUrl)}"
     style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;font-weight:bold;">
    לצפייה ביתרתך ←
  </a>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const webhookSecret = req.headers.get('x-webhook-secret')
  if (webhookSecret !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const newRecord = (payload as Record<string, unknown>).record as Record<string, unknown> | null
  const oldRecord = (payload as Record<string, unknown>).old_record as Record<string, unknown> | null

  if (
    !newRecord ||
    typeof newRecord.completed_by !== 'string' ||
    typeof newRecord.chore_assignment_id !== 'string' ||
    typeof newRecord.status !== 'string' ||
    !oldRecord ||
    typeof oldRecord.status !== 'string'
  ) {
    return new Response('Invalid webhook payload', { status: 400 })
  }

  // Only proceed when status transitions from pending → approved
  if (newRecord.status !== 'approved' || oldRecord.status !== 'pending') {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('FROM_EMAIL')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const appUrl = Deno.env.get('APP_URL') ?? ''

  if (!resendApiKey || !fromEmail || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required env vars: RESEND_API_KEY, FROM_EMAIL, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY')
    return new Response('Server misconfiguration', { status: 500 })
  }
  if (!appUrl) {
    console.warn('APP_URL is not set — CTA links in emails will be empty')
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Check if player has an auth email — skip silently if not (in-app notification handles it)
  const { data: authData, error: authError } = await supabase.auth.admin.getUserById(newRecord.completed_by)
  if (authError || !authData?.user?.email) {
    console.log(`Player ${newRecord.completed_by} has no auth email — skipping email notification`)
    return new Response(JSON.stringify({ ok: true, skipped: 'no email' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const playerEmail = authData.user.email

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', newRecord.completed_by)
    .single()

  if (profileError) {
    // Non-fatal: email sends addressed to fallback name 'שחקן' if profile lookup fails
    console.warn(`Profile query failed for ${newRecord.completed_by} — using fallback name:`, profileError)
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('chore_assignments')
    .select('chores(title, coin_value)')
    .eq('id', newRecord.chore_assignment_id)
    .single()

  if (assignmentError) {
    // Non-fatal: email sends with placeholder values (0 coins, generic name) if lookup fails
    console.warn('Assignment query failed — email will show 0 coins and placeholder chore name:', assignmentError)
  }

  const chore = assignment?.chores as { title: string; coin_value: number } | null | undefined

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: playerEmail,
      subject: `🎉 הגשתך אושרה! קיבלת ${chore?.coin_value ?? 0} מטבעות`,
      html: buildPlayerEmail(
        profile?.name ?? 'שחקן',
        chore?.title ?? 'משימה',
        chore?.coin_value ?? 0,
        appUrl
      ),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`Resend error for ${playerEmail}: ${res.status} ${body}`)
    // Return 200 (not 500) to avoid webhook retry loops that would send duplicate emails
    return new Response(JSON.stringify({ ok: false, error: 'email_send_failed' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.log(`Player approval notification sent to ${playerEmail}`)
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
