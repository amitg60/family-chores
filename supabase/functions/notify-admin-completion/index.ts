import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildAdminEmail(playerName: string, choreTitle: string, coinValue: number, appUrl: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="color:#1e1b4b;">✅ ${escapeHtml(playerName)} השלים/ה משימה</h2>
  <p>${escapeHtml(playerName)} השלים/ה את המשימה ״<strong>${escapeHtml(choreTitle)}</strong>״ ומחכה לאישורך.</p>
  <p>ערך המשימה: <strong>${coinValue} מטבעות</strong></p>
  <a href="${appUrl}"
     style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;font-weight:bold;">
    לאישור ההגשה ←
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

  const record = (payload as Record<string, unknown>).record as Record<string, unknown> | null
  if (
    !record ||
    typeof record.completed_by !== 'string' ||
    typeof record.chore_assignment_id !== 'string'
  ) {
    return new Response('Invalid webhook payload', { status: 400 })
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
    // Non-fatal: email sends with placeholder chore name if assignment lookup fails
    console.error('Assignment query failed:', assignmentError)
  }

  const chore = assignment?.chores as { title: string; coin_value: number } | null | undefined

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
      const { data: authData, error: authError } = await supabase.auth.admin.getUserById(admin.id)
      if (authError || !authData?.user?.email) return
      const adminEmail = authData.user.email

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: adminEmail,
          subject: `✅ ${profile.name} השלים/ה את המשימה ״${chore?.title ?? 'משימה'}״`,
          html: buildAdminEmail(profile.name, chore?.title ?? 'משימה', chore?.coin_value ?? 0, appUrl),
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        console.error(`Resend error for ${adminEmail}: ${res.status} ${body}`)
      } else {
        console.log(`Admin notification sent to ${adminEmail}`)
      }
    })
  )

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
