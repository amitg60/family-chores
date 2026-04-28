import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

function buildProposalEmail(
  proposerName: string,
  proposalTitle: string,
  entityType: 'chore' | 'reward',
  pageUrl: string
): string {
  const typeLabel = entityType === 'chore' ? 'משימה' : 'פרס'
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="color:#1e1b4b;margin:0 0 12px 0;">💡 הצעת ${escapeHtml(typeLabel)} חדשה</h2>
  <p style="margin:0 0 8px 0;">${escapeHtml(proposerName)} הציע/ה ${escapeHtml(typeLabel)} חדש/ה: ״<strong>${escapeHtml(proposalTitle)}</strong>״</p>
  <p style="margin:0 0 16px 0;">ההצעה ממתינה לאישורך.</p>
  <a href="${escapeHtml(pageUrl)}"
     style="display:inline-block;background:#1e1b4b;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:1rem;">
    עבור לדף האישורים
  </a>
</body>
</html>`
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
  if (!record) {
    return new Response('Invalid webhook payload', { status: 400 })
  }

  // Skip admin-created rows (no proposer)
  if (record.proposed_by == null) {
    return new Response(JSON.stringify({ ok: true, skipped: 'no_proposer' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Skip non-pending rows (defense-in-depth against webhook replays of edited rows)
  if (record.status !== 'pending_approval') {
    return new Response(JSON.stringify({ ok: true, skipped: 'not_pending' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const proposalId = record.id as string
  const proposedBy = record.proposed_by as string
  const proposalTitle = (record.title as string) ?? ''
  const familyId = record.family_id as string

  // Determine entity type from webhook table field
  const table = (payload as Record<string, unknown>).table as string | undefined
  const entityType: 'chore' | 'reward' = table === 'rewards' ? 'reward' : 'chore'

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('FROM_EMAIL')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const appUrl = Deno.env.get('APP_URL')

  if (!resendApiKey || !fromEmail || !supabaseUrl || !supabaseServiceKey || !appUrl) {
    console.error('Missing required env vars')
    return new Response('Server misconfiguration', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: proposer, error: proposerError } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', proposedBy)
    .single()

  if (proposerError || !proposer) {
    console.error('Proposer profile query failed:', proposerError)
    return new Response('Proposer not found', { status: 404 })
  }

  const { data: admins, error: adminsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('family_id', familyId)
    .eq('role', 'admin')

  if (adminsError) {
    console.error('Admins query failed:', adminsError)
    return new Response('Failed to fetch admins', { status: 500 })
  }

  const pageUrl = entityType === 'reward'
    ? `${appUrl}/admin/rewards`
    : `${appUrl}/admin`

  console.log(`[proposal] family=${familyId} entity=${entityType} admins=${admins?.length ?? 0}`)

  await Promise.all(
    (admins ?? []).map(async (admin) => {
      try {
        const { data: authData, error: authError } = await supabase.auth.admin.getUserById(admin.id)
        if (authError) {
          console.error(`[proposal] getUserById failed for admin ${admin.id}:`, authError.message)
          return
        }
        if (!authData?.user?.email) {
          console.error(`[proposal] no email for admin ${admin.id}`)
          return
        }
        const adminEmail = authData.user.email

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `proposal-${proposalId}-admin-${admin.id}`,
          },
          body: JSON.stringify({
            from: fromEmail,
            to: adminEmail,
            subject: `הצעה חדשה ממתינה לאישורך — ${proposer.name}`,
            html: buildProposalEmail(proposer.name, proposalTitle, entityType, pageUrl),
          }),
        })

        if (!res.ok) {
          const body = await res.text()
          console.error(`Resend error for ${adminEmail}: ${res.status} ${body}`)
        } else {
          console.log(`Proposal notification sent to ${adminEmail}`)
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
