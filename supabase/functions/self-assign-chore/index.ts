import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VALID_SLOTS = new Set(['morning', 'noon', 'afternoon'])

const ERRORS: Record<string, string> = {
  INVALID_INPUT:        'קלט לא תקין',
  INVALID_CALENDAR_DAY: 'יום לא תקין',
  INVALID_CALENDAR_SLOT:'חריץ זמן לא תקין',
  NOT_IN_FAMILY:        'אין הרשאה לגשת למשימה זו',
  CHORE_NOT_FOUND:      'המשימה לא נמצאה',
  CHORE_TAKEN:          'המשימה כבר נלקחה',
  ALREADY_ASSIGNED:     'כבר שויכת למשימה זו בחריץ זה',
  INTERNAL_ERROR:       'שגיאה פנימית',
}

function errorResponse(code: string, status = 400) {
  return new Response(
    JSON.stringify({ error: code, message: ERRORS[code] ?? ERRORS.INTERNAL_ERROR }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

function isValidUUID(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  return d.toISOString().split('T')[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  try {
    // ── Parse and validate input ──────────────────────────────────
    let body: { chore_id?: unknown; calendar_day?: unknown; calendar_slot?: unknown }
    try { body = await req.json() } catch { return errorResponse('INVALID_INPUT') }

    const { chore_id, calendar_day, calendar_slot } = body

    if (typeof chore_id !== 'string' || !isValidUUID(chore_id)) return errorResponse('INVALID_INPUT')

    if (calendar_day !== null && calendar_day !== undefined) {
      if (typeof calendar_day !== 'number' || !Number.isInteger(calendar_day) || calendar_day < 0 || calendar_day > 6) {
        return errorResponse('INVALID_CALENDAR_DAY')
      }
    }

    if (calendar_slot !== null && calendar_slot !== undefined) {
      if (typeof calendar_slot !== 'string' || !VALID_SLOTS.has(calendar_slot)) {
        return errorResponse('INVALID_CALENDAR_SLOT')
      }
    }

    const normalizedDay: number | null = calendar_day ?? null
    const normalizedSlot: string | null = calendar_slot ?? null

    // ── Auth: get calling user ────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('NOT_IN_FAMILY', 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return errorResponse('NOT_IN_FAMILY', 401)

    // ── Service role client for all DB writes ─────────────────────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Fetch caller's profile (family_id) ───────────────────────
    const { data: profile } = await admin
      .from('profiles')
      .select('family_id')
      .eq('id', user.id)
      .single()
    if (!profile?.family_id) return errorResponse('NOT_IN_FAMILY', 403)

    // ── Fetch chore and verify family membership ──────────────────
    const { data: chore } = await admin
      .from('chores')
      .select('id, family_id, status, is_pool_visible, recurrence_type')
      .eq('id', chore_id)
      .single()
    if (!chore) return errorResponse('CHORE_NOT_FOUND', 404)
    if (chore.family_id !== profile.family_id) return errorResponse('NOT_IN_FAMILY', 403)
    if (chore.status !== 'active' || !chore.is_pool_visible) return errorResponse('CHORE_NOT_FOUND', 404)

    const weekStart = getWeekStart(new Date())

    // ── Non-recurring: exclusivity guard ─────────────────────────
    if (chore.recurrence_type === 'none') {
      const { count } = await admin
        .from('chore_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('chore_id', chore_id)
        .not('status', 'in', '("failed","archived")')
      if ((count ?? 0) > 0) {
        console.log(JSON.stringify({ event: 'assign_rejected', reason: 'CHORE_TAKEN', chore_id, user_id: user.id, ts: new Date().toISOString() }))
        return errorResponse('CHORE_TAKEN', 409)
      }
    }

    // ── Insert assignment ─────────────────────────────────────────
    const { error: insertErr } = await admin
      .from('chore_assignments')
      .insert({
        chore_id,
        user_id: user.id,
        week_start: weekStart,
        calendar_day: normalizedDay,
        calendar_slot: normalizedSlot,
        status: 'pending',
        archived: false,
        reminder_enabled: false,
        assigned_by: user.id,
      })

    if (insertErr) {
      if (insertErr.code === '23505') {
        console.log(JSON.stringify({ event: 'assign_rejected', reason: 'ALREADY_ASSIGNED', chore_id, user_id: user.id, ts: new Date().toISOString() }))
        return errorResponse('ALREADY_ASSIGNED', 409)
      }
      console.log(JSON.stringify({ event: 'assign_error', message: insertErr.message, code: insertErr.code, chore_id, user_id: user.id, ts: new Date().toISOString() }))
      return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', message: 'שגיאה פנימית', _debug: `insert_err ${insertErr.code}: ${insertErr.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // ── Non-recurring: hide from pool ─────────────────────────────
    if (chore.recurrence_type === 'none') {
      await admin.from('chores').update({ is_pool_visible: false }).eq('id', chore_id)
    }

    // ── Notification ──────────────────────────────────────────────
    await admin.from('notifications').insert({
      user_id: user.id,
      family_id: profile.family_id,
      type: 'chore_assigned',
      title_he: 'משימה חדשה שויכה אליך',
      body_he: 'בדוק את הדשבורד שלך',
      related_entity_id: chore_id,
    })

    console.log(JSON.stringify({ event: 'chore_assigned', chore_id, user_id: user.id, assigned_by: user.id, recurrence_type: chore.recurrence_type, calendar_day: normalizedDay, calendar_slot: normalizedSlot, ts: new Date().toISOString() }))

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = String(err)
    console.log(JSON.stringify({ event: 'assign_error', message: msg, ts: new Date().toISOString() }))
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', message: 'שגיאה פנימית', _debug: `catch: ${msg}` }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
