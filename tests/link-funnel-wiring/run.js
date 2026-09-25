/**
 * Confirms the four real destinations are actually wired to
 * LinkFunnelHandoff, and — just as importantly — that Blade is not, since it
 * has no manual-entry field to seed (its URLs only ever come from a live
 * Google Maps search). Wiring a fake button onto Blade would have been worse
 * than not wiring it at all.
 *
 * Also pins the safety property that matters most here: none of the
 * step-through destinations (Nancy, SEO, Social) auto-run their paid/slow
 * external call just because a queue was waiting — every one of them only
 * prefills the field and waits for an explicit click, exactly like a normal
 * manual visit would.
 *
 *   node tests/link-funnel-wiring/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }

console.log('\n──── the sender page offers every wired destination, filterable by health-check status ────');
{
  const page = read('web/tools/link-funnel.html');
  check('loads the handoff module', page.includes('/js/link-funnel-handoff.js'));
  check('the destination list is populated from the module itself, not hand-duplicated', /TARGETS\)/.test(page) && /labelFor\(key\)/.test(page));
  check('a status filter exists so a stale/unreachable URL isn\'t sent by mistake', /handoff-status-filter/.test(page));
  check('sending an empty filtered list is refused with a clear message, not silently queued', /No URLs match that filter/.test(page));
}

console.log('\n──── Nancy: prefills its existing field, does not auto-run the research pipeline ────');
{
  const page = read('web/agents/nancy-agent.html');
  check('loads the handoff module', page.includes('/js/link-funnel-handoff.js'));
  check('peeks the nancy queue on load', /LinkFunnelHandoff\.peek\('nancy'\)/.test(page));
  check('prefills the real #url-input field', /document\.getElementById\('url-input'\)\.value = q\.urls\[q\.index\]/.test(page));
  check('does NOT call the research pipeline itself from the handoff code', !/renderLinkFunnelBanner[\s\S]{0,400}runResearchPipeline\(/.test(page));
  check('a multi-URL queue can be stepped through', /Skip to next/.test(page));
}

console.log('\n──── SEO agent: both Express Check and AI Citation Check are wired independently ────');
{
  const page = read('web/agents/seo-agent.html');
  check('loads the handoff module', page.includes('/js/link-funnel-handoff.js'));
  check('peeks the seo-express queue', /LinkFunnelHandoff\.peek\('seo-express'\)/.test(page) || /peek\(targetKey\)/.test(page));
  check('wires the express URL field', /renderLinkFunnelBanner\('seo-express', 'expressUrl'/.test(page));
  check('wires the AI-citation domain field separately', /renderLinkFunnelBanner\('seo-citation', 'geoDomain'/.test(page));
  check('does not auto-click Run Express Check or Check AI Citations', !/renderLinkFunnelBanner[\s\S]{0,600}runExpressCheck\(\)[\s\S]{0,10}renderLinkFunnelBanner/.test(page));
}

console.log('\n──── Social agent: opens the collapsed research widget and prefills it ────');
{
  const page = read('web/agents/social-agent.html');
  check('loads the handoff module', page.includes('/js/link-funnel-handoff.js'));
  check('peeks the social-research queue', /LinkFunnelHandoff\.peek\('social-research'\)/.test(page));
  check('opens the collapsed widget so the prefilled URL is actually visible', /researchInputRow'\)\.style\.display = 'flex'/.test(page));
  check('prefills the real #researchUrlInput field', /researchUrlInput'\)\.value = q\.urls\[q\.index\]/.test(page));
}

console.log('\n──── Competitive Watch: bulk-import confirmation, not a step-through (it\'s a cheap DB insert, not a paid call) ────');
{
  const page = read('web/agents/competitive-agent.html');
  check('loads the handoff module', page.includes('/js/link-funnel-handoff.js'));
  check('peeks the competitive-watch queue', /LinkFunnelHandoff\.peek\('competitive-watch'\)/.test(page));
  check('requires an explicit "Import all" click before adding anything', /lf-import-all/.test(page) && /addEventListener\('click', async \(\) => \{/.test(page));
  check('does not add competitors just from peeking the queue', !/renderLinkFunnelImportBanner[\s\S]{0,50}addWatch\(/.test(page));
  check('a failed add for one URL doesn\'t abort the rest of the batch', /catch \(e\) \{ failed\+\+; \}/.test(page));
}

console.log('\n──── Blade is deliberately NOT wired — no real manual-entry field to seed ────');
{
  const page = read('web/agents/blade-agent.html');
  check('Blade does not load the handoff module', !page.includes('link-funnel-handoff.js'));
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
