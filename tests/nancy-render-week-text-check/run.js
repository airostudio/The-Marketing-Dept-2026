/**
 * api/nancy-render-week.js — an AI-generated image's rendered text is
 * never trusted on the strength of the prompt asking it to "spell this
 * correctly". Image models bake text into pixels, not characters, and
 * can't actually guarantee that — this is the real mechanism behind
 * misspelled/garbled words showing up in finished Nancy creatives.
 * renderedTextLooksCorrect() spends one Claude vision call to actually
 * check, and a verified mismatch falls back to the deterministic SVG
 * templates, whose text is correct by construction.
 *
 *   node tests/nancy-render-week-text-check/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

function mockModule(relPath, exportsObj) {
  const p = require.resolve(path.join(REPO, relPath));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

mockModule('api/_lib/require-user.js', { requireUser: async () => ({ userId: 'u1' }) });
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/r2.js', { isR2Configured: () => false, uploadToR2: async () => null });

const post = { day: 1, slide_headline: 'Stop Losing Leads', slide_copy: 'Fast, friendly service.', cta: 'Book Now', objective: 'lead_gen' };

let claudeResult = null;
let claudeCallCount = 0;
mockModule('api/_lib/nancy-claude.js', {
  callClaudeForJSON: async () => { claudeCallCount++; return claudeResult; },
});

let genResult = null;
mockModule('api/_lib/nancy-providers.js', {
  imageGenProvider: async () => genResult,
});

function loadHandler() {
  const p = path.join(REPO, 'api/nancy-render-week.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}
function makeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}
async function call(body) {
  const res = makeRes();
  await loadHandler()({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res);
  return res;
}

(async () => {

console.log('\n──── the AI image ships when the rendered text checks out correct ────');
{
  claudeCallCount = 0;
  genResult = { available: true, buffer: Buffer.from('fake-png'), mimeType: 'image/png' };
  claudeResult = { success: true, data: { legible: true, transcription: 'Stop Losing Leads Fast, friendly service. Book Now' } };
  const res = await call({ post, brand: {}, businessName: 'Acme' });
  check('the AI image is used', res.body.asset.format === 'ai');
  check('exactly one verification call was made', claudeCallCount === 1);
}

console.log('\n──── a verified mismatch falls back to the exact-text SVG template ────');
{
  genResult = { available: true, buffer: Buffer.from('fake-png'), mimeType: 'image/png' };
  claudeResult = { success: true, data: { legible: true, transcription: 'Stop Loosing Leads Fast, freindly service. Book Now' } }; // misspelled
  const res = await call({ post, brand: {}, businessName: 'Acme' });
  check('falls back to the SVG template rather than shipping the misspelled image', res.body.asset.format === 'svg');
  check('the real reason is recorded, not a generic "AI unavailable"', /did not check out/.test(res.body.asset.fallbackReason));
}

console.log('\n──── the model saying "legible" is not enough on its own — its own transcription still has to match ────');
{
  genResult = { available: true, buffer: Buffer.from('fake-png'), mimeType: 'image/png' };
  claudeResult = { success: true, data: { legible: true, transcription: 'Some completely different text' } };
  const res = await call({ post, brand: {}, businessName: 'Acme' });
  check('still falls back — legible:true alone does not override a mismatched transcription', res.body.asset.format === 'svg');
}

console.log('\n──── an explicit "not legible" verdict falls back too ────');
{
  genResult = { available: true, buffer: Buffer.from('fake-png'), mimeType: 'image/png' };
  claudeResult = { success: true, data: { legible: false, transcription: 'Stop Lo...' } };
  const res = await call({ post, brand: {}, businessName: 'Acme' });
  check('falls back on an explicit illegible verdict', res.body.asset.format === 'svg');
}

console.log('\n──── an inconclusive check (verifier unavailable) fails OPEN — the AI image still ships ────');
{
  genResult = { available: true, buffer: Buffer.from('fake-png'), mimeType: 'image/png' };
  claudeResult = { success: false, error: 'ANTHROPIC_API_KEY not configured' };
  const res = await call({ post, brand: {}, businessName: 'Acme' });
  check('an inconclusive check is not treated as a verified failure', res.body.asset.format === 'ai');
}

console.log('\n──── no text requested means nothing to verify — skips straight through ────');
{
  claudeCallCount = 0;
  genResult = { available: true, buffer: Buffer.from('fake-png'), mimeType: 'image/png' };
  const textlessPost = { day: 2, objective: 'brand_awareness' };
  const res = await call({ post: textlessPost, brand: {}, businessName: 'Acme' });
  check('no verification call was made when there is no text to check', claudeCallCount === 0);
  check('the AI image still ships', res.body.asset.format === 'ai');
}

console.log('\n──── when the AI image was never available, no verification call happens either ────');
{
  claudeCallCount = 0;
  genResult = { available: false, reason: 'IMAGE_GEN_API_KEY not configured' };
  const res = await call({ post, brand: {}, businessName: 'Acme' });
  check('falls back to SVG with the real original reason', res.body.asset.format === 'svg' && res.body.asset.fallbackReason === 'IMAGE_GEN_API_KEY not configured');
  check('no verification call wasted on an image that does not exist', claudeCallCount === 0);
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
})();
