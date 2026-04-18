// supabase/functions/handle-completion-action/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store, max-age=0',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return new Response(JSON.stringify({ error: 'missing_token' }), { status: 400, headers: JSON_HEADERS })
  }

  const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('[INFRA] missing env vars')
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: JSON_HEADERS })
  }

  const parsed = await validateToken(token, webhookSecret)
  if (!parsed) {
    return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: JSON_HEADERS })
  }

  const { completionId, action, adminId } = parsed
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') {
    const { data: completion, error: statusError } = await supabase
      .from('chore_completions')
      .select('status')
      .eq('id', completionId)
      .single()

    if (statusError) {
      console.error(`[INFRA] completionId=${completionId} status check failed: ${statusError.message}`)
      return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: JSON_HEADERS })
    }

    if (!completion || completion.status !== 'pending') {
      return new Response(JSON.stringify({ status: 'already_actioned' }), { headers: JSON_HEADERS })
    }

    return new Response(JSON.stringify({ status: 'pending', action }), { headers: JSON_HEADERS })
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
        return new Response(JSON.stringify({ error: 'already_actioned' }), { headers: JSON_HEADERS })
      }
      console.error(`[INFRA] completionId=${completionId} action=${action} rpc failed: ${rpcError.message}`)
      return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: JSON_HEADERS })
    }

    return new Response(JSON.stringify({ success: true, action }), { headers: JSON_HEADERS })
  }

  return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: JSON_HEADERS })
})
