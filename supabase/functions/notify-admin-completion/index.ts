import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const webhookSecret = req.headers.get('x-webhook-secret')
  if (webhookSecret !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const payload = await req.json()
  const record = payload.record as {
    completed_by: string
    chore_assignment_id: string
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, family_id')
    .eq('id', record.completed_by)
    .single()

  if (!profile) {
    return new Response('Profile not found', { status: 404 })
  }

  const { data: assignment } = await supabase
    .from('chore_assignments')
    .select('chores(title, coin_value)')
    .eq('id', record.chore_assignment_id)
    .single()

  const chore = assignment?.chores as { title: string; coin_value: number } | null

  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .eq('family_id', profile.family_id)
    .eq('role', 'admin')

  const appUrl = Deno.env.get('APP_URL') ?? ''
  const resendApiKey = Deno.env.get('RESEND_API_KEY')!
  const fromEmail = Deno.env.get('FROM_EMAIL')!

  for (const admin of admins ?? []) {
    const { data: authData } = await supabase.auth.admin.getUserById(admin.id)
    const adminEmail = authData.user?.email
    if (!adminEmail) continue

    await fetch('https://api.resend.com/emails', {
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
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

function buildAdminEmail(playerName: string, choreTitle: string, coinValue: number, appUrl: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="color:#1e1b4b;">✅ ${playerName} השלים/ה משימה</h2>
  <p>${playerName} השלים/ה את המשימה ״<strong>${choreTitle}</strong>״ ומחכה לאישורך.</p>
  <p>ערך המשימה: <strong>${coinValue} מטבעות</strong></p>
  <a href="${appUrl}"
     style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;font-weight:bold;">
    לאישור ההגשה ←
  </a>
</body>
</html>`
}
