import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Exported for unit testing
export const SAFE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i

export function isValidPhotoPath(path: unknown): boolean {
  return (
    typeof path === 'string' &&
    !path.includes('..') &&
    SAFE_PATH_RE.test(path)
  )
}

export async function handler(req: Request): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error(JSON.stringify({ error: 'CRON_SECRET_NOT_CONFIGURED' }))
    return new Response('Internal Server Error', { status: 500 })
  }

  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // ── Supabase client (service_role — auto-injected by Supabase runtime) ────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  let orphansCleaned = 0
  let staleRejected = 0
  let proposalsCleaned = 0
  let errors = 0

  // ── Job 1: Orphaned photos ────────────────────────────────────────────────
  const { data: orphans, error: orphanQueryError } = await supabase
    .from('chore_completions')
    .select('id, photo_url')
    .in('status', ['approved', 'rejected'])
    .not('photo_url', 'is', null)
    .limit(50)

  if (orphanQueryError) {
    console.error(JSON.stringify({ error: 'ORPHAN_QUERY_FAILED', message: orphanQueryError.message }))
    errors++
  } else if (orphans) {
    if (orphans.length === 50) {
      console.warn(JSON.stringify({ warning: 'BATCH_LIMIT_REACHED', job: 'orphans', count: 50 }))
    }

    for (const completion of orphans) {
      if (!isValidPhotoPath(completion.photo_url)) {
        console.error(JSON.stringify({ error: 'INVALID_PATH', id: completion.id }))
        errors++
        continue
      }

      const { error: storageError } = await supabase.storage
        .from('completion-photos')
        .remove([completion.photo_url as string])

      if (storageError) {
        console.error(JSON.stringify({ error: 'STORAGE_DELETE_FAILED', id: completion.id }))
        errors++
        continue
      }

      const { error: dbError } = await supabase
        .from('chore_completions')
        .update({ photo_url: null })
        .eq('id', completion.id)

      if (dbError) {
        console.error(JSON.stringify({ error: 'DB_NULL_FAILED', id: completion.id }))
        errors++
        continue
      }

      orphansCleaned++
    }
  }

  // ── Job 2: Stale pending completions ──────────────────────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: stale, error: staleQueryError } = await supabase
    .from('chore_completions')
    .select('id, photo_url, chore_assignment_id')
    .eq('status', 'pending')
    .lt('completed_at', thirtyDaysAgo)
    .limit(50)

  if (staleQueryError) {
    console.error(JSON.stringify({ error: 'STALE_QUERY_FAILED', message: staleQueryError.message }))
    errors++
  } else if (stale) {
    if (stale.length === 50) {
      console.warn(JSON.stringify({ warning: 'BATCH_LIMIT_REACHED', job: 'stale', count: 50 }))
    }

    for (const completion of stale) {
      if (isValidPhotoPath(completion.photo_url)) {
        const { error: storageError } = await supabase.storage
          .from('completion-photos')
          .remove([completion.photo_url as string])
        if (storageError) {
          console.error(JSON.stringify({ error: 'STALE_STORAGE_DELETE_FAILED', id: completion.id }))
          errors++
        }
      } else if (completion.photo_url !== null) {
        console.error(JSON.stringify({ error: 'STALE_INVALID_PATH', id: completion.id }))
        errors++
      }

      const { error: rejectError } = await supabase
        .from('chore_completions')
        .update({
          status: 'rejected',
          rejection_reason: 'פג תוקף — לא אושר תוך 30 יום',
          photo_url: null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', completion.id)

      if (rejectError) {
        console.error(JSON.stringify({ error: 'STALE_REJECT_FAILED', id: completion.id }))
        errors++
        continue
      }

      const { error: assignError } = await supabase
        .from('chore_assignments')
        .update({ status: 'pending' })
        .eq('id', completion.chore_assignment_id)
        .not('status', 'in', '("completed","failed")')

      if (assignError) {
        console.error(JSON.stringify({
          error: 'ASSIGNMENT_RESET_FAILED_AFTER_REJECT',
          completion_id: completion.id,
          assignment_id: completion.chore_assignment_id,
        }))
        errors++
        continue
      }

      staleRejected++
    }
  }

  // ── Job 3: Stale rejected proposals ──────────────────────────────────────
  const { error: choreProposalError, count: choreCount } = await supabase
    .from('chores')
    .delete({ count: 'exact' })
    .eq('status', 'archived')
    .not('proposed_by', 'is', null)
    .lt('updated_at', thirtyDaysAgo)

  if (choreProposalError) {
    console.error(JSON.stringify({ error: 'CHORE_PROPOSALS_CLEANUP_FAILED', message: choreProposalError.message }))
    errors++
  } else {
    proposalsCleaned += choreCount ?? 0
  }

  const { error: rewardProposalError, count: rewardCount } = await supabase
    .from('rewards')
    .delete({ count: 'exact' })
    .eq('status', 'archived')
    .not('proposed_by', 'is', null)
    .lt('updated_at', thirtyDaysAgo)

  if (rewardProposalError) {
    console.error(JSON.stringify({ error: 'REWARD_PROPOSALS_CLEANUP_FAILED', message: rewardProposalError.message }))
    errors++
  } else {
    proposalsCleaned += rewardCount ?? 0
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  const result = { orphans_cleaned: orphansCleaned, stale_rejected: staleRejected, proposals_cleaned: proposalsCleaned, errors }
  const { error: logError } = await supabase.from('system_logs').insert({
    function_name: 'cleanup-photos',
    result,
    had_errors: errors > 0,
  })
  if (logError) {
    console.error(JSON.stringify({ error: 'SYSTEM_LOG_INSERT_FAILED', message: logError.message }))
  }

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(handler)
