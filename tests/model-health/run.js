/**
 * AI Model Health check (api/cron-agent-audit.js MODEL_REGISTRY /
 * testModelLive / auditModelHealth).
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * This app broke in production once already: OpenAI renamed a parameter
 * (max_tokens -> max_completion_tokens) for its newer models, and nothing
 * caught it until a customer hit the error. This check exists to catch
 * exactly that class of failure automatically, via real live API calls, not
 * an LLM's opinion about whether things "seem fine."
 *
 * The single most important behavior to verify: a confirmed, measured live
 * failure must never be softened or overridden by an LLM's own summary/
 * upToDate judgment — that's the whole point of not trusting the research
 * call alone.
 *
 *   node tests/model-health/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

const fail = [];
function check(label, cond) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) fail.push(label);
}

process.env.CRON_SECRET = 'test-cron-secret';
process.env.ANTHROPIC_API_KEY = 'sk-ant-api-test';
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
// OPENAI_API_KEY / GEMINI_API_KEY deliberately left UNSET for the first pass
// (see the "skip" section below), then set later for the full-run section.

const {
  MODEL_REGISTRY, testModelLive, auditModelHealth,
} = require(path.join(REPO, 'api/cron-agent-audit.js'));

const realFetch = global.fetch;

/* ── 1. Skips a model whose API key isn't configured ─────────────────────── */
console.log('\n──── missing key is a skip, not a failure ────');

(async () => {
  delete process.env.OPENAI_API_KEY;
  const gptEntry = MODEL_REGISTRY.find(m => m.id === 'gpt-5.6-luna');
  const r = await testModelLive(gptEntry, { anthropic: 'x', openai: undefined, gemini: 'x' });
  check('no OPENAI_API_KEY -> skipped: true, not ok: false', r.skipped === true && r.ok === undefined);
  check('the skip reason names the missing var', /OPENAI_API_KEY/.test(r.reason));

  /* ── 2. Real incident, captured verbatim ────────────────────────────────── */
  console.log('\n──── the real incident: OpenAI rejects an unsupported parameter ────');

  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.openai.com/v1/chat/completions')) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", code: 'unsupported_parameter' } }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const failResult = await testModelLive(gptEntry, { anthropic: 'x', openai: 'sk-test', gemini: 'x' });
  check('a real API rejection comes back ok: false', failResult.ok === false);
  check('with the real HTTP status', failResult.status === 400);
  check('and the VERBATIM error text, not paraphrased or swallowed',
    failResult.error.includes("Unsupported parameter: 'max_tokens'") &&
    failResult.error.includes('max_completion_tokens'));

  /* ── 3. A network failure/timeout is a legitimate result, not a crash ────── */
  console.log('\n──── a thrown network error never propagates past testModelLive ────');

  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND api.openai.com'); };
  let threw = false;
  let netResult;
  try { netResult = await testModelLive(gptEntry, { anthropic: 'x', openai: 'sk-test', gemini: 'x' }); }
  catch { threw = true; }
  check('testModelLive never throws', threw === false);
  check('a network failure is captured as ok: false with the real message',
    netResult && netResult.ok === false && /ENOTFOUND/.test(netResult.error));

  /* ── 4. Anthropic and Gemini text models, mirroring production request shape ── */
  console.log('\n──── the request shapes match each provider\'s real production endpoint ────');

  let seenAnthropicBody = null, seenGeminiBody = null, seenOpenAIImageUrl = null, seenGeminiImageUrl = null;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.anthropic.com/v1/messages')) {
      seenAnthropicBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'OK' }] }) };
    }
    if (u.includes('generativelanguage.googleapis.com') && u.includes(':generateContent')) {
      seenGeminiBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }) };
    }
    if (u.includes('generativelanguage.googleapis.com') && !u.includes(':generateContent')) {
      seenGeminiImageUrl = u;
      return { ok: true, status: 200, json: async () => ({ name: 'models/gemini-2.5-flash-image' }) };
    }
    if (u.includes('api.openai.com/v1/models/')) {
      seenOpenAIImageUrl = u;
      return { ok: true, status: 200, json: async () => ({ id: 'gpt-image-2.5-flare' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const claudeEntry = MODEL_REGISTRY.find(m => m.id === 'claude-sonnet-4-6');
  const claudeResult = await testModelLive(claudeEntry, { anthropic: 'sk-ant-test', openai: 'x', gemini: 'x' });
  check('Claude live test hits /v1/messages with max_tokens: 8 and a minimal message',
    seenAnthropicBody && seenAnthropicBody.max_tokens === 8 &&
    seenAnthropicBody.messages.length === 1 && seenAnthropicBody.messages[0].role === 'user');
  check('and comes back ok: true', claudeResult.ok === true);

  const geminiTextEntry = MODEL_REGISTRY.find(m => m.id === 'gemini-3.1-pro-preview');
  const geminiTextResult = await testModelLive(geminiTextEntry, { anthropic: 'x', openai: 'x', gemini: 'test-key' });
  check('Gemini live test mirrors api/gemini.js generateContent shape (contents[].parts[].text, generationConfig.maxOutputTokens)',
    seenGeminiBody && seenGeminiBody.contents[0].parts[0].text && seenGeminiBody.generationConfig.maxOutputTokens === 8);
  check('and comes back ok: true', geminiTextResult.ok === true);

  const openaiImageEntry = MODEL_REGISTRY.find(m => m.id === 'gpt-image-2.5-flare');
  const openaiImageResult = await testModelLive(openaiImageEntry, { anthropic: 'x', openai: 'sk-test', gemini: 'x' });
  check('OpenAI IMAGE model gets an existence check (GET /v1/models/{id}), never a real generation call',
    seenOpenAIImageUrl && seenOpenAIImageUrl.includes('/v1/models/gpt-image-2.5-flare'));
  check('and comes back ok: true', openaiImageResult.ok === true);

  const geminiImageEntry = MODEL_REGISTRY.find(m => m.id === 'gemini-2.5-flash-image');
  const geminiImageResult = await testModelLive(geminiImageEntry, { anthropic: 'x', openai: 'x', gemini: 'test-key' });
  check('Gemini IMAGE model gets a model-info GET, never a real (paid) generation call',
    seenGeminiImageUrl && seenGeminiImageUrl.includes('models/gemini-2.5-flash-image') && !seenGeminiImageUrl.includes(':generateContent'));
  check('and comes back ok: true', geminiImageResult.ok === true);

  /* ── 5. THE critical behavior: a live failure overrides Claude's own verdict ── */
  console.log('\n──── a confirmed live failure can never be talked out of by the LLM ────');

  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.anthropic.com/v1/messages')) {
      // Claude's research call insists everything is fine...
      const body = JSON.parse(opts.body);
      const toolUse = {
        type: 'tool_use',
        name: 'submit_agent_audit_finding',
        input: {
          upToDate: true, // <-- the LLM's own (wrong) judgment
          summary: 'All models appear healthy based on research.',
          gaps: [],
          recommendations: [],
          securityNotes: [],
          sources: [{ title: 'Example', url: 'https://example.com' }],
        },
      };
      return { ok: true, status: 200, json: async () => ({ content: [toolUse], stop_reason: 'tool_use' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const liveResultsWithOneFailure = [
    { id: 'claude-sonnet-4-6', provider: 'anthropic', ok: true },
    { id: 'gpt-5.6-luna', provider: 'openai', ok: false, status: 400, error: "Unsupported parameter: 'max_tokens' is not supported with this model." },
    { id: 'gemini-3.1-pro-preview', provider: 'gemini', ok: true },
  ];

  const finding = await auditModelHealth('sk-ant-test', liveResultsWithOneFailure);
  check('upToDate is forced to false even though Claude\'s tool call said true',
    finding.upToDate === false);
  check('the live failure is merged into gaps, quoting the real error verbatim',
    finding.gaps.some(g => g.includes('gpt-5.6-luna') && g.includes("Unsupported parameter: 'max_tokens'")));
  check('sources from the research call are preserved (never fabricated ones added)',
    finding.sources.length === 1 && finding.sources[0].url === 'https://example.com');

  // And the inverse: if nothing failed live, Claude's own judgment stands.
  const allHealthyFinding = await auditModelHealth('sk-ant-test', [
    { id: 'claude-sonnet-4-6', provider: 'anthropic', ok: true },
    { id: 'gemini-3.1-pro-preview', provider: 'gemini', ok: true },
  ]);
  check('with no live failures, upToDate reflects the research call (true here)',
    allHealthyFinding.upToDate === true);

  /* ── 6. The research call itself failing still surfaces live failures ────── */
  console.log('\n──── even if the research call itself errors, live failures still surface ────');

  global.fetch = async (url) => {
    if (String(url).includes('api.anthropic.com/v1/messages')) {
      return { ok: false, status: 529, json: async () => ({ error: { message: 'Overloaded' } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const findingWhenResearchFails = await auditModelHealth('sk-ant-test', liveResultsWithOneFailure);
  check('upToDate stays false from the live failure alone',
    findingWhenResearchFails.upToDate === false);
  check('the live failure gap is still present',
    findingWhenResearchFails.gaps.some(g => g.includes('gpt-5.6-luna')));
  check('never throws past auditModelHealth', true); // reaching this line proves it

  /* ── 7. The audit: spread over invocations, retried, never cut short ───── */
  console.log('\n──── the audit runs over several invocations, retrying what times out ────');

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.GEMINI_API_KEY = 'test-key';

  // A tiny stand-in for the two audit tables (PostgREST over fetch).
  const tables = { agent_audit_runs: [], agent_audit_findings: [] };
  let n = 0;
  function rest(u, opts) {
    const url = new URL(u); const t = url.pathname.split('/').pop(); const rows = tables[t];
    const params = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    const hit = rows.filter(r => params.every(([k, v]) => String(r[k]) === v.replace(/^eq\./, '')));
    const method = (opts && opts.method) || 'GET';
    if (method === 'POST') { const body = JSON.parse(opts.body); const list = (Array.isArray(body) ? body : [body]).map(b => ({ id: `id-${++n}`, run_at: b.run_at || new Date(Date.now()).toISOString(), ...b })); rows.push(...list); return list; }
    if (method === 'PATCH') { hit.forEach(r => Object.assign(r, JSON.parse(opts.body))); return hit; }
    const sorted = t === 'agent_audit_runs' ? hit.slice().sort((a, b) => (a.run_at < b.run_at ? 1 : -1)) : hit;
    return url.searchParams.get('limit') ? sorted.slice(0, Number(url.searchParams.get('limit'))) : sorted;
  }
  let slowAgents = new Set(), anthropicCalls = 0;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/agent_audit_')) { const data = rest(u, opts); return { ok: true, status: 200, json: async () => data }; }
    if (u.includes('api.anthropic.com/v1/messages')) {
      anthropicCalls++;
      const prompt = JSON.parse(opts.body).messages[0].content;
      const slow = [...slowAgents].find(k => prompt.includes(k));
      if (slow) { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
      return { ok: true, status: 200, json: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_agent_audit_finding', input: { upToDate: true, summary: 'ok', gaps: [], recommendations: [], securityNotes: [], sources: [] } }] }) };
    }
    if (u.includes('api.openai.com/v1/chat/completions')) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) };
    if (u.includes('api.openai.com/v1/models/')) return { ok: true, status: 200, json: async () => ({ id: 'gpt-image-2.5-flare' }) };
    if (u.includes('generativelanguage.googleapis.com') && u.includes(':generateContent')) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }) };
    if (u.includes('generativelanguage.googleapis.com')) return { ok: true, status: 200, json: async () => ({ name: 'models/gemini-2.5-flash-image' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const handler = require(path.join(REPO, 'api/cron-agent-audit.js'));
  const invoke = async (query = {}) => { let body = null; const res = { headersSent: false, status() { return this; }, json(b) { body = b; this.headersSent = true; return this; } }; await handler({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' }, query, body: {} }, res); return body; };

  check('each agent now gets well over the old 40s for its web research', handler.PER_AGENT_TIMEOUT_MS >= 100000);
  check('the cron fires every 10 minutes through the audit window', /"\/api\/cron-agent-audit", "schedule": "\*\/10 6-8 1 \*\/2 \*"/.test(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8')));
  const seoKey = 'SEO Intelligence (Rex)';
  slowAgents = new Set([seoKey]);
  let out = await invoke();
  const run = tables.agent_audit_runs[0];
  check('the first invocation starts one audit and researches a batch in parallel (not all 16 at once)', out.success && out.status === 'running' && run.status === 'running' && run.agent_count === 16 && out.researchedNow === 8);
  check('…saving each finding as it lands; the slow one is counted, not recorded as a failure yet', tables.agent_audit_findings.length === 7 && run.progress && run.progress.seo.attempts === 1 && /longer than 110s/.test(run.progress.seo.lastError));
  out = await invoke();
  check('the next invocation carries on with the rest (the timed-out one goes to the back)', out.status === 'running' && tables.agent_audit_findings.length === 15 && !tables.agent_audit_findings.some(f => f.agent_key === 'seo'));
  slowAgents = new Set();
  out = await invoke();
  check('…and retries the one that timed out, which now succeeds', tables.agent_audit_findings.length === 16 && tables.agent_audit_findings.find(f => f.agent_key === 'seo').error === null);
  check('when every agent has a finding, the run is closed with a real summary', run.status === 'completed' && run.finished_at && /Audited 16 agents — 0 flagged with gaps\./.test(run.overall_summary) && out.failedCount === 0);
  const ids = new Set(tables.agent_audit_findings.map(f => f.run_id));
  check('every finding (model health included) belongs to that one run', ids.size === 1 && ids.has(run.id) && tables.agent_audit_findings.some(f => f.agent_key === 'platform-model-health' && f.agent_label === 'AI Model Health (Platform Infrastructure)'));
  const callsBefore = anthropicCalls;
  out = await invoke();
  check('once done, the rest of the window does nothing (no second audit, no spend)', out.skipped === true && anthropicCalls === callsBefore && tables.agent_audit_runs.length === 1);

  slowAgents = new Set([seoKey]);
  await invoke({ force: '1' });
  for (let k = 0; k < 4; k++) await invoke();
  const run2 = tables.agent_audit_runs.find(r => r.id !== run.id);
  const seo2 = tables.agent_audit_findings.find(f => f.run_id === run2.id && f.agent_key === 'seo');
  check('an agent that keeps timing out is recorded as failed after 3 tries, with the reason', run2.status === 'partial' && seo2 && /longer than 110s \(after 3 tries\)/.test(seo2.error) && seo2.up_to_date === true);
  check('…and the summary says how many couldn\'t be researched', /1 couldn't be researched after 3 tries/.test(run2.overall_summary));
  check('the Scotty card only shows finished audits', /\.neq\('status', 'running'\)/.test(fs.readFileSync(path.join(REPO, 'web/scotty.html'), 'utf8')));

  global.fetch = realFetch;

  console.log(fail.length === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${fail.length} FAILED: ${fail.join(' | ')}\n`);
  process.exit(fail.length === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
