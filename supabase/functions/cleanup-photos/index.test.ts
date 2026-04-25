import { assertEquals, assertFalse } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { isValidPhotoPath, SAFE_PATH_RE } from './index.ts'

const VALID_PATH =
  '123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001.webp'

// ── isValidPhotoPath ──────────────────────────────────────────────────────────

Deno.test('isValidPhotoPath: valid UUID/webp path returns true', () => {
  assertEquals(isValidPhotoPath(VALID_PATH), true)
})

Deno.test('isValidPhotoPath: path with .. traversal returns false', () => {
  assertFalse(isValidPhotoPath('../other-bucket/secret.webp'))
})

Deno.test('isValidPhotoPath: wrong extension returns false', () => {
  assertFalse(
    isValidPhotoPath(
      '123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001.jpg'
    )
  )
})

Deno.test('isValidPhotoPath: single segment (no directory) returns false', () => {
  assertFalse(isValidPhotoPath('secret.webp'))
})

Deno.test('isValidPhotoPath: empty string returns false', () => {
  assertFalse(isValidPhotoPath(''))
})

Deno.test('isValidPhotoPath: null returns false', () => {
  assertFalse(isValidPhotoPath(null))
})

Deno.test('isValidPhotoPath: non-UUID prefix returns false', () => {
  assertFalse(isValidPhotoPath('admin/123e4567-e89b-12d3-a456-426614174001.webp'))
})

Deno.test('isValidPhotoPath: path with embedded .. returns false', () => {
  assertFalse(
    isValidPhotoPath(
      '123e4567-e89b-12d3-a456-426614174000/../../etc/passwd'
    )
  )
})

// ── Handler auth rejection ────────────────────────────────────────────────────
// Skip if CRON_SECRET env var is not set (CI without secrets).

const CRON_SECRET = Deno.env.get('CRON_SECRET')

Deno.test({
  name: 'handler: missing Authorization header returns 401',
  ignore: !CRON_SECRET,
  fn: async () => {
    const { handler } = await import('./index.ts')
    const req = new Request('http://localhost/', { method: 'POST' })
    const res = await handler(req)
    assertEquals(res.status, 401)
  },
})

Deno.test({
  name: 'handler: wrong secret returns 401',
  ignore: !CRON_SECRET,
  fn: async () => {
    const { handler } = await import('./index.ts')
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    const res = await handler(req)
    assertEquals(res.status, 401)
  },
})
