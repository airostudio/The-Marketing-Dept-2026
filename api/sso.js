/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WEBESE SSO — Vercel Serverless Function
 *
 * Validates a short-lived JWT issued by Webese, then creates (or logs in) the
 * user in Marketing Dept's Supabase project by generating a Supabase magic-link.
 * The browser is redirected through the magic-link flow, which lands the user
 * on the CMO dashboard already signed in — no separate account needed.
 *
 * Environment variables required (Vercel dashboard → Settings → Env Vars):
 *   WEBESE_SSO_SECRET        — shared HMAC-SHA256 secret, must match Webese
 *   SUPABASE_URL             — Marketing Dept Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS, never exposed)
 *   APP_URL                  — public URL of this deployment (for redirect_to)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict'

const crypto = require('crypto')

// ── Env ────────────────────────────────────────────────────────────────────────
const SSO_SECRET      = process.env.WEBESE_SSO_SECRET
const SUPABASE_URL    = process.env.SUPABASE_URL    || 'https://gbitapjzewhkzljqfvyc.supabase.co'
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL         = process.env.APP_URL         || 'https://the-marketing-dept-2026.vercel.app'

// ── JWT helpers (HS256, no external deps) ─────────────────────────────────────

function b64urlDecode(str) {
  // base64url → utf8 string
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function verifyJWT(token, secret) {
  if (!token || !secret) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')

  // Constant-time comparison
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null

  try {
    const data = JSON.parse(b64urlDecode(payload))
    if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null
    return data
  } catch {
    return null
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS — only Webese origins
  const origin = req.headers.origin || ''
  if (origin.endsWith('.webese.ai') || origin === 'https://webese.ai') {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const { token } = req.query

  if (!token) {
    return res.redirect(302, `${APP_URL}/auth/sso.html?error=missing_token`)
  }

  if (!SSO_SECRET) {
    console.error('[sso] WEBESE_SSO_SECRET not set')
    return res.redirect(302, `${APP_URL}/auth/sso.html?error=misconfigured`)
  }

  const payload = verifyJWT(String(token), SSO_SECRET)
  if (!payload) {
    return res.redirect(302, `${APP_URL}/auth/sso.html?error=invalid_token`)
  }

  if (!SUPABASE_SVC_KEY) {
    console.error('[sso] SUPABASE_SERVICE_ROLE_KEY not set')
    return res.redirect(302, `${APP_URL}/auth/sso.html?error=misconfigured`)
  }

  // Generate a Supabase magic link for the user (creates account if needed)
  const redirectTo = `${APP_URL}/marketing/cmo-dashboard.html`

  let actionLink
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         SUPABASE_SVC_KEY,
        Authorization: `Bearer ${SUPABASE_SVC_KEY}`,
      },
      body: JSON.stringify({
        type: 'magiclink',
        email: payload.email,
        data: {
          // Pass Webese user info so the profiles trigger can populate the row
          firstname: payload.name?.split(' ')[0] || '',
          lastname:  payload.name?.split(' ').slice(1).join(' ') || '',
          webese_user_id: payload.sub,
        },
        options: { redirect_to: redirectTo },
      }),
    })

    if (!resp.ok) {
      const body = await resp.text()
      console.error('[sso] Supabase generate_link failed:', resp.status, body)
      return res.redirect(302, `${APP_URL}/auth/sso.html?error=supabase_error`)
    }

    const json = await resp.json()
    actionLink = json.action_link || json.data?.action_link
    if (!actionLink) {
      console.error('[sso] No action_link in response:', JSON.stringify(json))
      return res.redirect(302, `${APP_URL}/auth/sso.html?error=no_link`)
    }
  } catch (err) {
    console.error('[sso] Network error calling Supabase:', err)
    return res.redirect(302, `${APP_URL}/auth/sso.html?error=network_error`)
  }

  // Send the browser through the Supabase magic-link verification flow.
  // Supabase will verify the OTP, then redirect to `redirect_to` with
  // #access_token=…&refresh_token=… in the fragment — the Supabase JS
  // client on the dashboard page auto-establishes the session from the hash.
  return res.redirect(302, actionLink)
}
