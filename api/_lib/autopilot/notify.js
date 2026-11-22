/**
 * api/_lib/autopilot/notify.js — the work Audema's other background jobs do
 * on their own (Blade sweeps, competitor watch, scheduled posts, email flows)
 * reported in "What happened", so nothing finishes or breaks silently.
 *
 * Each function takes the 3-argument sb (method, path, body) and never
 * throws: a report that can't be written must not stop the job itself.
 */

'use strict';

const activity = require('./activity.js');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
async function safe(fn) { try { return await fn(); } catch { return null; } }

/** Blade sweep: finished, or paused (search budget, Google refusing, tracker problems). */
function sweepResult(sb, sweep, out, deps) {
  if (!out || !out.ran || !['done', 'paused'].includes(out.status)) return Promise.resolve(null);
  const name = str(sweep.name, 120) || 'Area sweep';
  const t = out.totals || sweep.totals || {};
  const counts = `${t.searched || 0} towns searched · ${t.qualified || 0} businesses qualified${sweep.write_to_tracker ? ` · ${t.written || 0} added to the tracker` : ''}`;
  const quota = /quota|refused|403|429|denied|billing/i.test(out.note || '');
  const ev = out.status === 'done'
    ? { kind: 'done', title: `Blade finished sweeping ${name}`, body: counts, action: { type: 'link', href: '/agents/blade-sweeps.html' } }
    : { kind: quota ? 'needs_permission' : 'info', title: `Blade paused the ${name} sweep`, body: `${str(out.note, 400)}\n\n${counts}\n\n${quota ? 'Google Places stopped answering (a quota or billing limit). When it is sorted, resume the sweep and it carries on from where it stopped.' : 'Resume it from Blade\'s area sweeps when you are ready; it carries on from where it stopped.'}`, action: { type: 'link', href: '/agents/blade-sweeps.html' } };
  return safe(() => activity.record(sb, { user_id: sweep.user_id, intel_profile_id: sweep.intel_profile_id, project_id: sweep.project_id, agent: 'blade', ...ev, dedupeHours: 24 }, deps));
}

/** Competitor watch: a tracked page changed. */
function competitorChanged(sb, watch, changes, deps) {
  if (!changes || !changes.length) return Promise.resolve(null);
  const lines = changes.map(c => (c.change_type === 'content' ? '• The page\'s wording changed.' : `• ${c.change_type === 'title' ? 'Title' : 'Description'}: "${str(c.previous_value, 160)}" → "${str(c.new_value, 160)}"`));
  return safe(() => activity.record(sb, {
    user_id: watch.user_id, agent: 'competitive', kind: 'info',
    title: `${str(watch.name, 80) || 'A competitor'} changed their page`,
    body: `${str(watch.url, 300)}\n${lines.join('\n')}`,
    action: { type: 'link', href: '/agents/competitive-agent.html' },
  }, deps));
}

/** A scheduled social post could not be published. */
function postFailed(sb, post, result, deps) {
  const notConnected = /not_connected|not connected|token|auth|permission/i.test(`${result && result.status} ${result && result.error}`);
  return safe(() => activity.record(sb, {
    user_id: post.user_id, intel_profile_id: post.intel_profile_id, project_id: post.project_id, agent: 'social',
    kind: notConnected ? 'needs_permission' : 'failed',
    title: notConnected ? `${str(post.platform, 40)} isn't connected, so scheduled posts can't go out` : `A scheduled ${str(post.platform, 40)} post couldn't be published`,
    body: notConnected
      ? `"${str(post.headline || post.body, 120)}" was due but Audema can't post to ${str(post.platform, 40)} for you yet. Post it yourself from Social Studio's Content Calendar, or connect ${str(post.platform, 40)} when that becomes available.`
      : `"${str(post.headline || post.body, 120)}" — ${str(result && (result.error || result.status), 300)}. Nothing was posted. Open it in Social Studio's Content Calendar to fix and reschedule.`,
    action: { type: 'link', href: '/agents/social-agent.html' },
    dedupeHours: notConnected ? 24 : 0,
  }, deps));
}

/** An email flow step couldn't be sent: something the business can fix. */
const FLOW_REASONS = {
  no_from_address: 'it has no "from" address. Add one to the flow (or set a default sender).',
  copy_not_sendable: 'the email still has unfinished copy (placeholders or merge tags). Finish the step\'s copy.',
  missing_fields: 'it uses merge fields this contact doesn\'t have. Remove them or add a fallback.',
  send_failed: 'the email service rejected it.',
  send_error: 'the email service didn\'t answer.',
};
function flowSendFailed(sb, { userId, flowName, outcome, detail }, deps) {
  if (!FLOW_REASONS[outcome]) return Promise.resolve(null);
  return safe(() => activity.record(sb, {
    user_id: userId, agent: 'email', kind: 'failed',
    title: `Email flow "${str(flowName, 80) || 'Untitled'}" couldn't send a step`,
    body: `A step wasn't sent because ${FLOW_REASONS[outcome]}${detail ? `\n\n${str(detail, 300)}` : ''}\n\nOther contacts in the flow are affected the same way until it's fixed.`,
    action: { type: 'link', href: '/marketing/email-marketing.html' },
    dedupeHours: 24,
  }, deps));
}

module.exports = { sweepResult, competitorChanged, postFailed, flowSendFailed, FLOW_REASONS };
