/**
 * api/_lib/autopilot/registry.js — which agents can run on autopilot, and
 * the job handler for each. Adding an agent means adding its handler here;
 * the runner, self-repair, inbox and trust ramp come with it.
 */

'use strict';

const drafts = require('./drafts.js');

const HANDLERS = [require('./seo.js'), drafts.analytics, drafts.cro, drafts.social];

const byAgent = new Map(HANDLERS.map(h => [h.agent, h]));
const byKind = new Map(HANDLERS.map(h => [h.kind, h]));

module.exports = {
  forAgent: (a) => byAgent.get(a) || null,
  forKind: (k) => byKind.get(k) || null,
  agents: () => HANDLERS.map(h => ({ agent: h.agent, label: h.label, approvalOnly: !!h.approvalOnly })),
};
