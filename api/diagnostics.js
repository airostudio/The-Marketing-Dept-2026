/**
 * System diagnostics — Vercel serverless function.
 *
 * GET  /api/diagnostics           → system environment checks
 * POST /api/diagnostics/project   → project integration checks (body: { projectId })
 *
 * No secrets are returned to the client. Only pass/warn/fail status per service.
 */

const { requireUser, requireAdmin, callerOwnsScope } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;


// ── helpers ──────────────────────────────────────────────────────────────────

function envCheck(id, name, vars, hint) {
  const missing = vars.filter(v => !process.env[v]);
  if (missing.length === 0) {
    return { id, name, status: 'ok', message: 'Configured.' };
  }
  if (missing.length < vars.length) {
    return {
      id, name, status: 'warn',
      message: `Partially configured. Missing: ${missing.join(', ')}. ${hint || ''}`
    };
  }
  return {
    id, name, status: 'warn',
    message: `Not configured (${missing.join(', ')} missing). ${hint || ''} This feature will be unavailable.`
  };
}

async function ping(id, name, url, opts, timeoutMs = 5000) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    if (res.status === 401 || res.status === 403) {
      return { id, name, status: 'ok', message: 'Reachable (auth required as expected).', latencyMs };
    }
    if (res.ok || res.status < 500) {
      return { id, name, status: 'ok', message: `Reachable (HTTP ${res.status}).`, latencyMs };
    }
    return { id, name, status: 'warn', message: `Returned HTTP ${res.status}.`, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    if (err.name === 'AbortError') {
      return { id, name, status: 'warn', message: `Timed out after ${timeoutMs}ms.`, latencyMs };
    }
    return { id, name, status: 'warn', message: `Unreachable: ${err.message}`, latencyMs };
  }
}

/**
 * Confirms which Company Pages LINKEDIN_ACCESS_TOKEN can actually administer,
 * and whether the configured org URN is one of them. This is the one live
 * signal LinkedIn's own publish error can't give: "Data Processing Exception
 * ... [/author]" fires identically whether the org id is wrong or the token
 * lacks w_organization_social, so guessing between the two wastes an OAuth
 * re-run on the wrong fix. organizationAcls answers it directly.
 */
async function checkLinkedInOrgAccess(id, name, accessToken, configuredUrnRaw) {
  const configuredUrn = String(configuredUrnRaw || '').trim();
  const t0 = Date.now();
  try {
    const res = await fetch(
      'https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(id,localizedName)))',
      { headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' }, signal: AbortSignal.timeout(8000) }
    );
    const latencyMs = Date.now() - t0;
    if (res.status === 401) {
      return { id, name, status: 'error', message: 'LINKEDIN_ACCESS_TOKEN is expired or invalid — re-run the OAuth authorization.', latencyMs };
    }
    if (res.status === 403) {
      return { id, name, status: 'error', message: 'LINKEDIN_ACCESS_TOKEN does not have organization access at all — the "Community Management API" product is likely not approved on this LinkedIn app yet, or the token was authorized without w_organization_social.', latencyMs };
    }
    if (!res.ok) {
      return { id, name, status: 'warn', message: `LinkedIn returned HTTP ${res.status} listing administered organizations.`, latencyMs };
    }
    const data = await res.json().catch(() => ({}));
    const orgs = (data.elements || []).map(el => {
      const org = el['organization~'] || {};
      return { urn: `urn:li:organization:${org.id}`, name: org.localizedName || `org ${org.id}` };
    });
    if (!orgs.length) {
      return { id, name, status: 'error', message: 'This token can administer ZERO organizations — whoever authorized it is not an admin of any Company Page. Re-run the OAuth authorization signed in as a real admin of the target page.', latencyMs };
    }
    const match = orgs.find(o => o.urn === configuredUrn);
    if (match) {
      return { id, name, status: 'ok', message: `Confirmed — this token can post as "${match.name}" (${match.urn}), matching LINKEDIN_ORGANIZATION_URN.`, latencyMs };
    }
    return {
      id, name, status: 'error',
      message: `LINKEDIN_ORGANIZATION_URN (${configuredUrn}) is NOT one this token can administer. It CAN post as: ${orgs.map(o => `${o.name} (${o.urn})`).join(', ')}. ` +
        (orgs.length ? 'Either update LINKEDIN_ORGANIZATION_URN to one of these, or re-run the OAuth authorization signed in as an admin of the correct page.' : ''),
      latencyMs,
    };
  } catch (err) {
    return { id, name, status: 'warn', message: `Could not reach LinkedIn: ${err.message}`, latencyMs: Date.now() - t0 };
  }
}

/** Confirms LINKEDIN_PERSON_ACCESS_TOKEN is live and identifies whose profile it posts as. */
async function checkLinkedInPersonToken(id, name, accessToken, configuredUrnRaw) {
  const configuredUrn = String(configuredUrnRaw || '').trim();
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - t0;
    if (res.status === 401) {
      return { id, name, status: 'error', message: 'LINKEDIN_PERSON_ACCESS_TOKEN is expired or invalid — re-run the OAuth authorization.', latencyMs };
    }
    if (!res.ok) {
      return { id, name, status: 'warn', message: `LinkedIn returned HTTP ${res.status}.`, latencyMs };
    }
    const data = await res.json().catch(() => ({}));
    const actualUrn = data.sub ? `urn:li:person:${data.sub}` : null;
    if (actualUrn && actualUrn !== configuredUrn) {
      return {
        id, name, status: 'error',
        message: `LINKEDIN_PERSON_URN (${configuredUrn}) does not match the member this token actually belongs to (${actualUrn}, ${data.name || 'unknown name'}). Update LINKEDIN_PERSON_URN to ${actualUrn}.`,
        latencyMs,
      };
    }
    return { id, name, status: 'ok', message: `Confirmed — token belongs to ${data.name || actualUrn}, matching LINKEDIN_PERSON_URN.`, latencyMs };
  } catch (err) {
    return { id, name, status: 'warn', message: `Could not reach LinkedIn: ${err.message}`, latencyMs: Date.now() - t0 };
  }
}

// ── System checks ─────────────────────────────────────────────────────────────

async function runSystemChecks() {
  const checks = [];

  // 1. Anthropic / Claude
  checks.push(envCheck(
    'claude', 'Anthropic Claude',
    ['ANTHROPIC_API_KEY'],
    'Required for AI-powered content, SEO suggestions, and the Scotty assistant.'
  ));

  // 2. Resend (email)
  checks.push(envCheck(
    'resend', 'Resend (email)',
    ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
    'Required for cold email campaigns and pipeline outreach.'
  ));

  // 3. Hunter.io
  checks.push(envCheck(
    'hunter', 'Hunter.io',
    ['HUNTER_API_KEY'],
    'Required for email verification and lead enrichment.'
  ));

  // 4. Perplexity
  checks.push(envCheck(
    'perplexity', 'Perplexity Sonar',
    ['PERPLEXITY_API_KEY'],
    'Required for company and person enrichment in lead profiles.'
  ));

  // 5. Google PageSpeed
  checks.push(envCheck(
    'pagespeed', 'Google PageSpeed',
    ['GOOGLE_PAGESPEED_API_KEY'],
    'Optional but recommended — unauthenticated requests are heavily rate-limited.'
  ));

  // 6. Supabase
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    checks.push({ id: 'supabase_cfg', name: 'Supabase config', status: 'ok', message: 'URL and key configured.' });
  } else {
    checks.push({
      id: 'supabase_cfg', name: 'Supabase config', status: 'warn',
      message: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set. Projects and data will only persist in the browser.'
    });
  }

  // 7. DataForSEO
  checks.push(envCheck(
    'dataforseo', 'DataForSEO',
    ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'],
    'Required for keyword research, SERP analysis, and backlink data.'
  ));

  // 8. Optional integrations
  checks.push(envCheck(
    'semrush', 'SEMrush',
    ['SEMRUSH_API_KEY'],
    'Optional — enables SEMrush keyword and traffic data.'
  ));

  checks.push(envCheck(
    'unsplash', 'Unsplash',
    ['UNSPLASH_ACCESS_KEY'],
    'Optional — enables stock photo search for content generation.'
  ));

  // LinkedIn Company Page — a live check, not just presence. Both env vars
  // being SET is not the same as the token being valid for THIS org: the
  // "[/author] Data Processing Exception" LinkedIn returns on a bad publish
  // is caused by either (a) the configured org id not being one the token
  // administers, or (b) the token lacking w_organization_social — and it
  // gives no way to tell which. organizationAcls answers that directly: it
  // lists every org this specific token can actually administer, so the
  // configured URN can be checked against a real list instead of guessed at.
  if (process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_ORGANIZATION_URN) {
    checks.push(await checkLinkedInOrgAccess(
      'linkedin_org', 'LinkedIn Company Page',
      process.env.LINKEDIN_ACCESS_TOKEN, process.env.LINKEDIN_ORGANIZATION_URN
    ));
  } else {
    checks.push(envCheck(
      'linkedin_org', 'LinkedIn Company Page',
      ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORGANIZATION_URN'],
      'Required to publish to the Company Page from Social Studio.'
    ));
  }

  // LinkedIn personal profile — same live check, different scope
  // (w_member_social) and a token issued to one specific member rather than
  // an org, so there is no ACL list to compare against — /v2/userinfo alone
  // confirms the token is live and identifies whose profile it will post as.
  if (process.env.LINKEDIN_PERSON_ACCESS_TOKEN && process.env.LINKEDIN_PERSON_URN) {
    checks.push(await checkLinkedInPersonToken(
      'linkedin_person', 'LinkedIn personal profile',
      process.env.LINKEDIN_PERSON_ACCESS_TOKEN, process.env.LINKEDIN_PERSON_URN
    ));
  } else {
    checks.push({
      id: 'linkedin_person', name: 'LinkedIn personal profile', status: 'skipped',
      message: 'LINKEDIN_PERSON_ACCESS_TOKEN / LINKEDIN_PERSON_URN not set — personal-profile publishing is optional.'
    });
  }

  // 9. Runtime / deployment
  checks.push({
    id: 'runtime',
    name: 'Serverless runtime',
    status: 'ok',
    message: `Node.js ${process.version} · ${process.env.VERCEL ? 'Vercel' : 'local'} environment.`
  });

  // 10. Connectivity spot-check (Anthropic API endpoint)
  if (process.env.ANTHROPIC_API_KEY) {
    const conn = await ping(
      'conn_anthropic', 'Anthropic API connectivity',
      'https://api.anthropic.com',
      { method: 'HEAD' }
    );
    checks.push(conn);
  } else {
    checks.push({ id: 'conn_anthropic', name: 'Anthropic API connectivity', status: 'skipped', message: 'Skipped — API key not configured.' });
  }

  const summary = checks.reduce(
    (acc, c) => {
      if (c.status === 'ok') acc.passed++;
      else if (c.status === 'warn') acc.warnings++;
      else if (c.status === 'skipped') acc.skipped++;
      else acc.failed++;
      return acc;
    },
    { passed: 0, warnings: 0, failed: 0, skipped: 0 }
  );

  return { summary, checks };
}

// ── Project integration checks ────────────────────────────────────────────────

async function runProjectChecks(projectId) {
  const checks = [];

  checks.push({
    id: 'project_id',
    name: 'Project ID',
    status: 'ok',
    message: `Active project: ${projectId}`
  });

  // Resend — try listing emails to validate key
  if (process.env.RESEND_API_KEY) {
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.resend.com/emails?limit=1', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - t0;
      checks.push({
        id: 'resend_auth', name: 'Resend API auth',
        status: res.ok ? 'ok' : (res.status === 401 ? 'error' : 'warn'),
        message: res.ok ? 'API key valid — email sending available.' : `Returned HTTP ${res.status}.`,
        latencyMs
      });
    } catch (err) {
      checks.push({ id: 'resend_auth', name: 'Resend API auth', status: 'warn', message: err.message, latencyMs: Date.now() - t0 });
    }
  } else {
    checks.push({ id: 'resend_auth', name: 'Resend API auth', status: 'skipped', message: 'RESEND_API_KEY not set.' });
  }

  // Hunter.io — account info
  if (process.env.HUNTER_API_KEY) {
    const t0 = Date.now();
    try {
      const res = await fetch(
        `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(process.env.HUNTER_API_KEY)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      const latencyMs = Date.now() - t0;
      if (res.ok) {
        const data = await res.json();
        const plan = data?.data?.plan_name || 'unknown plan';
        const requests = data?.data?.requests;
        const used = requests?.searches?.used ?? '?';
        const max = requests?.searches?.available ?? '?';
        checks.push({
          id: 'hunter_auth', name: 'Hunter.io API auth',
          status: 'ok',
          message: `API key valid. Plan: ${plan}. Email searches used: ${used}/${max}.`,
          latencyMs
        });
      } else {
        checks.push({ id: 'hunter_auth', name: 'Hunter.io API auth', status: res.status === 401 ? 'error' : 'warn', message: `HTTP ${res.status}`, latencyMs });
      }
    } catch (err) {
      checks.push({ id: 'hunter_auth', name: 'Hunter.io API auth', status: 'warn', message: err.message, latencyMs: Date.now() - t0 });
    }
  } else {
    checks.push({ id: 'hunter_auth', name: 'Hunter.io API auth', status: 'skipped', message: 'HUNTER_API_KEY not set.' });
  }

  // Perplexity — connectivity
  if (process.env.PERPLEXITY_API_KEY) {
    const conn = await ping(
      'perplexity_conn', 'Perplexity API connectivity',
      'https://api.perplexity.ai',
      { method: 'HEAD' }
    );
    checks.push(conn);
  } else {
    checks.push({ id: 'perplexity_conn', name: 'Perplexity API connectivity', status: 'skipped', message: 'PERPLEXITY_API_KEY not set.' });
  }

  // PageSpeed — unauthenticated reachability
  const psConn = await ping(
    'pagespeed_conn', 'Google PageSpeed API',
    'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com' +
      (process.env.GOOGLE_PAGESPEED_API_KEY ? `&key=${encodeURIComponent(process.env.GOOGLE_PAGESPEED_API_KEY)}` : ''),
    { method: 'HEAD' }
  );
  checks.push(psConn);

  // Supabase — reachability
  const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (sbUrl) {
    const conn = await ping('supabase_conn', 'Supabase connectivity', sbUrl + '/rest/v1/', { method: 'HEAD' });
    checks.push(conn);
  } else {
    checks.push({ id: 'supabase_conn', name: 'Supabase connectivity', status: 'skipped', message: 'SUPABASE_URL not set.' });
  }

  return { checks };
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = withFailureReporting('api/diagnostics', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const urlPath = (req.url || '').split('?')[0].replace(/\/$/, '');
  const isProjectRoute = urlPath.endsWith('/project');

  if (isProjectRoute) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // The project route is about the caller's own project, so any signed-in
    // owner may run it — but it names the project in the request body, and it
    // makes live authenticated calls to that project's integrations. Checking
    // ownership is what stops one customer probing another's setup.
    const auth = await requireUser(req, res);
    if (!auth) return;

  // After authentication: the burst limit is keyed on the account, so
  // it needs the caller to exist before it runs.
  if (rateLimited(req, res, { name: 'diagnostics', max: 20, windowMs: 60 * 1000, auth: auth })) return;
    let body = {};
    if (typeof req.body === 'object' && req.body !== null) {
      body = req.body;
    } else if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body); } catch { /* ignore */ }
    }
    const { projectId } = body;
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }
    if (!(await callerOwnsScope(auth.userId, { projectId }))) {
      return res.status(403).json({ error: 'That project is not yours.', code: 'scope_forbidden' });
    }
    try {
      const result = await runProjectChecks(projectId);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(result);
    } catch (err) {
      console.error('[diagnostics/project] error:', err.message);
      return res.status(500).json({ error: 'Diagnostics failed', detail: err.message });
    }
  }

  // System checks — GET only
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // These describe the deployment, not the caller: which services are wired
  // up, which environment variables are missing, which upstreams are
  // reachable. That is an operator's view of the platform, not a customer's.
  const sysAuth = await requireAdmin(req, res);
  if (!sysAuth) return;

  try {
    const result = await runSystemChecks();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[diagnostics] error:', err.message);
    return res.status(500).json({ error: 'Diagnostics failed', detail: err.message });
  }
});
