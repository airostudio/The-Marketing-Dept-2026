// Ad-hoc end-to-end smoke test — spawns the built server and drives it over
// stdio like a real MCP client would, exercising the full workflow.
import { spawn } from 'node:child_process';

const proc = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let id = 1;
const pending = new Map();

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch (e) {
      console.error('non-JSON line from server:', line);
    }
  }
});
proc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

function send(method, params) {
  const reqId = id++;
  const msg = { jsonrpc: '2.0', id: reqId, method, params };
  proc.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((resolve) => pending.set(reqId, resolve));
}

function callTool(name, args) {
  return send('tools/call', { name, arguments: args });
}

function text(res) {
  return res?.result?.content?.[0]?.text ?? JSON.stringify(res);
}

async function main() {
  await send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const toolsList = await send('tools/list', {});
  console.log('\n=== TOOLS REGISTERED:', toolsList.result.tools.length, '===');
  console.log(toolsList.result.tools.map((t) => t.name).join(', '));

  console.log('\n=== 1. create_brand_profile ===');
  const brandRes = await callTool('create_brand_profile', {
    businessName: 'Frostbite HVAC',
    industry: 'Residential HVAC repair',
    targetAudience: 'Homeowners aged 35-65 whose heating or AC has just failed',
    brandVoice: 'Direct, reassuring, no-nonsense — like a trusted neighbour who happens to be a master tradesman',
    colours: { primary: '#1E3A8A', secondary: '#F97316', accent: '#F97316', background: '#0B1220', text: '#FFFFFF' },
    fonts: { heading: 'Montserrat', body: 'Inter' },
    forbiddenPhrases: ['cheapest', 'bargain'],
    preferredCTA: ['Book Same-Day Service', 'Call Now'],
    proofPoints: ['4.9 stars from 1,200+ local reviews', '15 years serving the metro area'],
    guarantees: ['100% satisfaction guarantee or the visit is free'],
    commonOffers: ['$49 diagnostic fee waived with repair'],
  });
  console.log(text(brandRes));
  const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
  const brandId = text(brandRes).match(UUID_RE)?.[1];
  console.log('Extracted brandId:', brandId);

  console.log('\n=== 2. create_ad_brief ===');
  const briefRes = await callTool('create_ad_brief', {
    businessDescription: 'Frostbite HVAC is a residential heating and cooling repair company. This campaign is for a mid-winter furnace-failure emergency response promo.',
    campaignGoal: 'Drive same-day emergency furnace repair calls during a cold snap',
    brandProfileId: brandId,
  });
  console.log(text(briefRes));
  const briefId = text(briefRes).match(/id: ([a-f0-9-]+)/)?.[1];

  console.log('\n=== 3. submit_customer_analysis ===');
  const analysisRes = await callTool('submit_customer_analysis', {
    briefId,
    targetCustomer: 'A homeowner whose furnace just died on the coldest night of the year, panicking about pipes freezing and kids being cold',
    painPoints: [
      'Furnace stopped working overnight and the house is freezing',
      'Worried about frozen/burst pipes if heat stays off much longer',
      'Past bad experience with a repair company that never showed up',
    ],
    offer: 'Same-day emergency furnace repair, $49 diagnostic fee waived with any repair',
    objections: ['Will they actually come today?', 'Is this going to cost a fortune for an emergency call?'],
    desiredAction: 'Call now for same-day emergency service',
  });
  console.log(text(analysisRes));

  console.log('\n=== 4. generate_ad_angles (pain-point, offer, urgency) ===');
  const anglesRes = await callTool('generate_ad_angles', { briefId, angleTypes: ['pain-point', 'offer', 'urgency'] });
  console.log(text(anglesRes).slice(0, 600) + '...\n[guidance truncated for readability]');

  console.log('\n=== 5. save_ad_concepts (3 concepts) ===');
  const saveRes = await callTool('save_ad_concepts', {
    concepts: [
      {
        briefId,
        conceptName: 'Frozen Pipes Panic',
        angleType: 'pain-point',
        targetEmotion: 'relief',
        customerPainPoint: 'Furnace stopped working overnight and the house is freezing',
        hook: 'Furnace dead at midnight?',
        headline: 'Furnace Dead? We Fix It Tonight.',
        subheadline: 'Same-day emergency repair before pipes freeze — one call away.',
        cta: 'Call Now',
        proofPoint: '4.9 stars from 1,200+ local reviews',
        urgencyLine: undefined,
        visualDirection: 'Close-up of a frost-covered window at night with warm interior light glowing through, deep navy background matching brand primary',
        platformSize: 'square',
        conversionRationale: 'Names the exact 2am panic moment and promises same-night resolution, which directly answers their #1 objection about response speed.',
        abTestSuggestion: 'Test against an offer-led headline to see if price relief or speed relief pulls harder.',
      },
      {
        briefId,
        conceptName: 'Waived Fee Offer',
        angleType: 'offer',
        targetEmotion: 'confidence',
        customerPainPoint: 'Worried the emergency call will cost a fortune',
        hook: '$49 diagnostic fee? Waived.',
        headline: 'Free Diagnostic With Same-Day Repair',
        subheadline: 'No surprise bills — the $49 check-up is on us when we fix it today.',
        cta: 'Book Same-Day Service',
        proofPoint: '15 years serving the metro area',
        visualDirection: 'Clean product-style shot of a technician\'s toolbox and furnace panel, warm orange accent lighting matching brand accent colour',
        platformSize: 'landscape',
        conversionRationale: 'Directly neutralises the cost objection with a real, specific waived fee — not a vague discount.',
        abTestSuggestion: 'Test the offer amount framing ($49 waived) against a percentage-off framing.',
      },
      {
        briefId,
        conceptName: 'Cold Snap Countdown',
        angleType: 'urgency',
        targetEmotion: 'urgency',
        customerPainPoint: 'Pipes could freeze the longer the heat stays off',
        hook: 'Every hour without heat raises the risk.',
        headline: 'Cold Snap Warning: Book Today',
        subheadline: 'Techs are booking fast during this freeze — same-day slots are limited.',
        cta: 'Call Now',
        urgencyLine: 'Same-day slots filling up during this cold snap',
        visualDirection: 'Thermometer icon dropping toward freezing, bold orange urgency badge in corner, dark navy background',
        platformSize: 'story',
        conversionRationale: 'Uses a real, weather-driven urgency mechanic (not fabricated scarcity) tied directly to the pipe-freezing pain point.',
        abTestSuggestion: 'Test against the pain-point concept to see whether urgency or empathy drives faster action.',
      },
    ],
  });
  console.log(text(saveRes));

  const conceptIds = [...text(saveRes).matchAll(/id: ([a-f0-9-]+)/g)].map((m) => m[1]);
  console.log('\nConcept IDs:', conceptIds);

  console.log('\n=== 6. score_ad_concepts (re-rank) ===');
  const scoreRes = await callTool('score_ad_concepts', { briefId });
  console.log(text(scoreRes));

  console.log('\n=== 7. generate_layout ===');
  const layoutRes = await callTool('generate_layout', { conceptId: conceptIds[0], platformSize: 'square' });
  console.log(text(layoutRes));

  console.log('\n=== 8. export_ad_image (PNG) ===');
  const exportRes = await callTool('export_ad_image', { conceptId: conceptIds[0], platformSize: 'square', format: 'png' });
  console.log(text(exportRes));

  console.log('\n=== 9. export_ad_image_all_sizes ===');
  const exportAllRes = await callTool('export_ad_image_all_sizes', { conceptId: conceptIds[1], format: 'jpg' });
  console.log(text(exportAllRes));

  console.log('\n=== 10. save_campaign_result ===');
  const campaignRes = await callTool('save_campaign_result', {
    brandProfileId: brandId,
    briefId,
    conceptId: conceptIds[0],
    platform: 'Meta',
    dateRange: '2026-01-01 to 2026-01-14',
    spend: 850,
    impressions: 42000,
    clicks: 1260,
    leads: 38,
    revenue: 5700,
    winningCreativeNotes: 'The frost-covered window visual stopped the scroll — CTR nearly 2x the account average.',
  });
  console.log(text(campaignRes));

  console.log('\n=== 11. get_campaign_insights ===');
  const insightsRes = await callTool('get_campaign_insights', { brandProfileId: brandId });
  console.log(text(insightsRes));

  console.log('\n=== 12. generate_ab_test_recommendations ===');
  const abRes = await callTool('generate_ab_test_recommendations', { conceptIds });
  console.log(text(abRes));

  console.log('\n=== 13. create_campaign_draft (no platform credentials — should save locally, not error) ===');
  const draftRes = await callTool('create_campaign_draft', {
    brandProfileId: brandId,
    conceptId: conceptIds[0],
    platform: 'meta',
    campaignName: 'Smoke Test Campaign',
    objective: 'OUTCOME_TRAFFIC',
    dailyBudgetCents: 2500,
    targeting: { countries: ['US'], ageMin: 25, ageMax: 54, interests: ['home services'] },
  });
  console.log(text(draftRes));

  console.log('\n=== 14. create_campaign_draft (budget over ceiling — should be rejected, not created) ===');
  const overBudgetRes = await callTool('create_campaign_draft', {
    brandProfileId: brandId,
    conceptId: conceptIds[0],
    platform: 'meta',
    campaignName: 'Should Be Rejected',
    objective: 'OUTCOME_TRAFFIC',
    dailyBudgetCents: 99_999_999,
    targeting: { countries: ['US'] },
  });
  console.log(text(overBudgetRes), overBudgetRes.result?.isError ? '(correctly rejected)' : '(⚠️ SHOULD HAVE BEEN REJECTED)');

  console.log('\n=== 15. list_campaign_drafts ===');
  const listDraftsRes = await callTool('list_campaign_drafts', { brandProfileId: brandId });
  console.log(text(listDraftsRes));

  console.log('\n=== ALL STEPS COMPLETED ===');
  proc.stdin.end();
  proc.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('E2E TEST FAILED:', err);
  proc.kill();
  process.exit(1);
});
