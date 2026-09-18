/**
 * api/_lib/ab-split.js — assign a recipient to a split-test variant.
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── Why this is deterministic rather than random ─────────────────────────
 *
 * A send can be retried: a batch fails halfway, the operator re-runs it, or a
 * flow step is re-processed after a timeout. With Math.random() the same
 * person can land in variant A on the first attempt and B on the second, and
 * then their open is counted against a variant they were never shown. Hashing
 * the address means the answer is the same every time it is asked, so a retry
 * re-derives the assignment it already made instead of inventing a new one.
 *
 * It also means the split is stable across the whole send without holding a
 * counter, which would have to be shared between concurrent batches.
 */

'use strict';

const crypto = require('crypto');

/**
 * A stable 0-99 bucket for a recipient within one test.
 *
 * The test id is mixed in so a contact who is in two tests is not forced into
 * the same relative position in both — otherwise every test would split the
 * audience along the identical line and the second test would be measuring a
 * population already skewed by the first.
 */
function bucketFor(testId, email) {
  const key = `${testId}:${String(email).trim().toLowerCase()}`;
  const digest = crypto.createHash('sha256').update(key).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * Pick the variant for one recipient.
 *
 * @param {Array} variants - [{ id, label, split_pct, ... }] in a stable order.
 * @param {string} testId
 * @param {string} email
 * @returns {object|null} the chosen variant, or null when the splits are unusable.
 */
function assignVariant(variants, testId, email) {
  if (!Array.isArray(variants) || variants.length === 0) return null;

  // Order by label so the bucket ranges are the same on every call regardless
  // of the order the rows came back from Postgres. Without this a query that
  // returned B before A would silently swap who receives what between two
  // runs of the same send.
  const ordered = variants.slice().sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const total = ordered.reduce((sum, v) => sum + (Number(v.split_pct) || 0), 0);
  if (total <= 0) return null;

  // Splits that do not total 100 are scaled rather than rejected: a test set
  // up as 30/30 should still send to everybody, in the ratio the operator
  // asked for. Only an empty or negative total is unusable.
  const bucket = bucketFor(testId, email);
  const scaled = bucket * total / 100;

  let cursor = 0;
  for (const v of ordered) {
    cursor += Number(v.split_pct) || 0;
    if (scaled < cursor) return v;
  }
  return ordered[ordered.length - 1];
}

/**
 * How the test currently stands.
 *
 * Rates are null, never 0, when a variant has no delivered mail behind them —
 * "this arm has no data yet" and "this arm converted nobody" are different
 * facts, and a leader picked between them would be picked on noise.
 */
function summariseResults(rows, goal) {
  const measure = goal === 'click' ? 'unique_clicked' : 'unique_opened';

  const variants = (rows || []).map((r) => {
    const delivered = Number(r.delivered || 0);
    const hits = Number(r[measure] || 0);
    return {
      variantId: r.variant_id,
      label: r.label,
      subject: r.subject || null,
      splitPct: Number(r.split_pct || 0),
      assigned: Number(r.assigned || 0),
      delivered,
      uniqueOpened: Number(r.unique_opened || 0),
      uniqueClicked: Number(r.unique_clicked || 0),
      rate: delivered > 0 ? Math.round((hits / delivered) * 1000) / 10 : null,
    };
  });

  const measured = variants.filter((v) => v.rate !== null);

  // A leader is only meaningful once every arm has delivered mail; otherwise
  // the arm that happens to have been processed first always "wins".
  let leader = null;
  if (measured.length === variants.length && variants.length > 1) {
    const sorted = measured.slice().sort((a, b) => b.rate - a.rate);
    if (sorted[0].rate > sorted[1].rate) leader = sorted[0].label;
  }

  const totalDelivered = variants.reduce((s, v) => s + v.delivered, 0);

  return {
    goal: goal === 'click' ? 'click' : 'open',
    variants,
    leader,
    // Deliberately not called a winner. This is a raw comparison of two rates,
    // not a significance test — at these volumes a few opens can reverse it,
    // and calling it a winner would invite a permanent decision from noise.
    readable: totalDelivered === 0
      ? 'No mail has been delivered for this test yet.'
      : measured.length < variants.length
        ? 'Not every variant has delivered mail yet, so there is nothing to compare.'
        : leader
          ? `${leader} is ahead on ${goal === 'click' ? 'click' : 'open'} rate. ` +
            'This is a raw comparison, not a significance test — treat it as a lead, not a verdict.'
          : 'The variants are level on this measure.',
  };
}

module.exports = { bucketFor, assignVariant, summariseResults };
