import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function isValidUUID(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function getWeekStart(date: Date): string {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().split('T')[0]
}

const ERRORS: Record<string, string> = {
  INVALID_INPUT:      'קלט לא תקין',
  NOT_IN_FAMILY:      'אין הרשאה',
  NOT_ADMIN:          'פעולה זו מוגבלת למנהלים בלבד',
  CHORE_NOT_FOUND:    'המשימה לא נמצאה',
  TOO_MANY_ASSIGNEES: 'ניתן לשייך רק שחקן אחד למשימה שאינה חוזרת',
  INTERNAL_ERROR:     'שגיאה פנימית',
}

function errorResponse(code: string, status = 400) {
  return new Response(
    JSON.stringify({ error: code, message: ERRORS[code] ?? ERRORS.INTERNAL_ERROR }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  try {
    let body: { chore_id?: unknown; user_ids?: unknown }
    try { body = await req.json() } catch { return errorResponse('INVALID_INPUT') }

    const { chore_id, user_ids } = body
    if (typeof chore_id !== 'string' || !isValidUUID(chore_id)) return errorResponse('INVALID_INPUT')
    if (!Array.isArray(user_ids) || user_ids.length === 0) return errorResponse('INVALID_INPUT')
    if (!user_ids.every((id): id is string => typeof id === 'string' && isValidUUID(id))) return errorResponse('INVALID_INPUT')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('NOT_IN_FAMILY', 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return errorResponse('NOT_IN_FAMILY', 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('family_id, role')
      .eq('id', user.id)
      .single()
    if (!callerProfile?.family_id) return errorResponse('NOT_IN_FAMILY', 403)
    if (callerProfile.role !== 'admin') return errorResponse('NOT_ADMIN', 403)

    const { data: chore } = await admin
      .from('chores')
      .select('id, family_id, status, recurrence_type')
      .eq('id', chore_id)
      .single()
    if (!chore) return errorResponse('CHORE_NOT_FOUND', 404)
    if (chore.family_id !== callerProfile.family_id) return errorResponse('NOT_IN_FAMILY', 403)
    if (chore.status !== 'active') return errorResponse('CHORE_NOT_FOUND', 404)

    // Non-recurring: only one assignee allowed
    if (chore.recurrence_type === 'none' && user_ids.length > 1) {
      return errorResponse('TOO_MANY_ASSIGNEES', 422)
    }

    // Verify all user_ids belong to the same family
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact' })
      .in('id', user_ids)
      .eq('family_id', callerProfile.family_id)
    if ((count ?? 0) !== user_ids.length) return errorResponse('NOT_IN_FAMILY', 403)

    const weekStart = getWeekStart(new Date())
    const rows = user_ids.map((uid: string) => ({
      chore_id,
      user_id: uid,
      week_start: weekStart,
      status: 'pending',
      archived: false,
      reminder_enabled: false,
      assigned_by: user.id,
    }))

    const { error: insertErr } = await admin
      .from('chore_assignments')
      .insert(rows)
    if (insertErr && insertErr.code !== '23505') {
      console.log(JSON.stringify({ event: 'admin_assign_error', message: insertErr.message, chore_id, ts: new Date().toISOString() }))
      return errorResponse('INTERNAL_ERROR', 500)
    }

    if (chore.recurrence_type === 'none') {
      await admin.from('chores').update({ is_pool_visible: false }).eq('id', chore_id)
    }

    // Notifications for each assignee
    const notifications = user_ids.map((uid: string) => ({
      user_id: uid,
      family_id: callerProfile.family_id,
      type: 'chore_assigned',
      title_he: 'משימה חדשה שויכה אליך',
      body_he: 'בדוק את הדשבורד שלך',
      related_entity_id: chore_id,
    }))
    await admin.from('notifications').insert(notifications)

    console.log(JSON.stringify({ event: 'admin_chore_assigned', chore_id, user_ids, assigned_by: user.id, ts: new Date().toISOString() }))

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.log(JSON.stringify({ event: 'admin_assign_error', message: String(err), ts: new Date().toISOString() }))
    return errorResponse('INTERNAL_ERROR', 500)
  }
})
