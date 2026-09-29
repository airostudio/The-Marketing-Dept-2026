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
      return { ok: true, status: 200, json: async () => ({ id: 'gpt-image-1' }) };
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

  const openaiImageEntry = MODEL_REGISTRY.find(m => m.id === 'gpt-image-1');
  const openaiImageResult = await testModelLive(openaiImageEntry, { anthropic: 'x', openai: 'sk-test', gemini: 'x' });
  check('OpenAI IMAGE model gets an existence check (GET /v1/models/{id}), never a real generation call',
    seenOpenAIImageUrl && seenOpenAIImageUrl.includes('/v1/models/gpt-image-1'));
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

  /* ── 7. Wired into the SAME run/findings insert as the per-agent loop ────── */
  console.log('\n──── one run, one findings insert — not a parallel table ────');

  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.GEMINI_API_KEY = 'test-key';

  let insertedRun = null;
  let insertedFindings = null;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.anthropic.com/v1/messages')) {
      // Every agent audit call AND the model-health research call go through
      // here — return a valid finding for all of them.
      return {
        ok: true, status: 200,
        json: async () => ({
          stop_reason: 'tool_use',
          content: [{
            type: 'tool_use', name: 'submit_agent_audit_finding',
            input: { upToDate: true, summary: 'ok', gaps: [], recommendations: [], securityNotes: [], sources: [] },
          }],
        }),
      };
    }
    if (u.includes('api.openai.com/v1/chat/completions')) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) };
    }
    if (u.includes('api.openai.com/v1/models/')) {
      return { ok: true, status: 200, json: async () => ({ id: 'gpt-image-1' }) };
    }
    if (u.includes('generativelanguage.googleapis.com') && u.includes(':generateContent')) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }) };
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ name: 'models/gemini-2.5-flash-image' }) };
    }
    if (u.includes('/rest/v1/agent_audit_runs')) {
      insertedRun = JSON.parse(opts.body);
      return { ok: true, status: 201, json: async () => ([{ id: 'run-123', ...insertedRun }]) };
    }
    if (u.includes('/rest/v1/agent_audit_findings')) {
      insertedFindings = JSON.parse(opts.body);
      return { ok: true, status: 201, json: async () => (insertedFindings) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const handler = require(path.join(REPO, 'api/cron-agent-audit.js'));
  let statusCode = null, jsonBody = null;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { jsonBody = b; return this; },
  };
  await handler({ method: 'POST', headers: { authorization: 'Bearer test-cron-secret' }, body: {} }, res);

  check('the handler responds success', jsonBody && jsonBody.success === true);
  check('agent_audit_runs got exactly one row', insertedRun && !Array.isArray(insertedRun));
  check('agent_count includes the +1 for AI Model Health',
    insertedRun && insertedRun.agent_count === 16); // 15 specialist agents + 1
  check('agent_audit_findings insert is ONE array carrying every specialist finding PLUS platform-model-health',
    Array.isArray(insertedFindings) && insertedFindings.length === 16);
  const modelHealthRow = insertedFindings && insertedFindings.find(f => f.agent_key === 'platform-model-health');
  check('the model-health finding is present with the right agent_key/agent_label',
    modelHealthRow && modelHealthRow.agent_label === 'AI Model Health (Platform Infrastructure)');
  check('it shares the same run_id as every other finding in this run',
    modelHealthRow && insertedFindings.every(f => f.run_id === modelHealthRow.run_id));
  check('all specialist findings came back healthy in this fixture, so up_to_date is true for them',
    insertedFindings.filter(f => f.agent_key !== 'platform-model-health').every(f => f.up_to_date === true));

  global.fetch = realFetch;

  console.log(fail.length === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${fail.length} FAILED: ${fail.join(' | ')}\n`);
  process.exit(fail.length === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
