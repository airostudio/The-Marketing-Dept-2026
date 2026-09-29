/**
 * api/_lib/lead-scoring.js — server-side port of blade-agent.html's
 * opportunityRank()/personalizedNote() so api/cron-sales-intel-sweep.js can
 * score and describe a lead the same way a human running Blade by hand
 * would, without a browser to run the client-side copy in.
 *
 * Keep this in sync with window.__bladeInternals in web/agents/blade-agent.html
 * (tests/blade-mailmerge-audit/run.js exercises that copy directly) — this
 * file is the same logic, ported to plain CommonJS with no DOM dependency.
 *
 * personalizedNote()'s platform-lock wording is deliberately NOT a "save
 * money" pitch: switching hosting providers to cut a bill is a much weaker
 * reason to move than "you're on a template thousands of other businesses
 * also use, and a Webese site isn't a template." The note names the
 * platform and the sameness problem — it never invents a dollar figure or a
 * guaranteed outcome, since nothing about pricing was actually measured.
 */

'use strict';

const PLATFORM_LABELS = { wix: 'Wix', squarespace: 'Squarespace', godaddy: 'GoDaddy Website Builder' };

function opportunityRank(r) {
  if (r.siteStatus === 'no_website') return 0;
  if (r.sitePlatform) return 1;
  if (r.siteStatus === 'outdated') return 2;
  if (r.siteStatus === 'check_failed') return 3;
  if (r.siteStatus === 'unreachable') return 4;
  return 5;
}

function personalizedNote(r) {
  if (r.siteStatus === 'no_website') return 'Currently relies on Google listing';

  if (r.sitePlatform) {
    const label = PLATFORM_LABELS[r.sitePlatform] || r.sitePlatform;
    return `On a ${label} template — looks like thousands of other sites, not built for them specifically`;
  }

  const reasons = r.siteReasons || [];
  if (reasons.some(x => /viewport/i.test(x))) return 'Mobile layout is difficult to use';
  if (reasons.some(x => /copyright/i.test(x))) return "Hasn't updated the site in years";
  if (reasons.some(x => /Flash/i.test(x))) return 'Uses old technology that no longer works on most phones';
  if (reasons.some(x => /HTTPS/i.test(x))) return "Site isn't even served securely (no HTTPS)";
  if (reasons.some(x => /outdated platform/i.test(x))) return 'Running a very old, unsupported website platform';

  return '';
}

module.exports = { opportunityRank, personalizedNote };
