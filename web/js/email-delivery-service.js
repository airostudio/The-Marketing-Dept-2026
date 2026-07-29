/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EMAIL DELIVERY SERVICE — "Pat" the mailman agent — Audema
 *
 * Takes drafted campaign emails (from Content Studio / Email Engine) and gets
 * them out the door:
 *
 *   collateCampaign()   → normalize subject/body + a recipient list into one
 *                          campaign object
 *   reviewWithScotty()  → sends the collated campaign to Scotty for a QA pass
 *                          (compliance, spam triggers, broken merge tags,
 *                          missing unsubscribe footer) — BLOCKS sending on
 *                          unresolved issues
 *   sendCampaign()      → once approved, dispatches to /api/send-campaign.js
 *                          in batches, reporting per-recipient results
 *
 * Nothing in this file sends an email without a passing (or explicitly
 * overridden) Scotty review first.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const EmailDeliveryService = (() => {
  'use strict';

  const BATCH_SIZE = 25; // matches MAX_BATCH_SIZE in api/send-campaign.js

  /* ─────────────────────────────────────────────────────────────────────────
     COLLATE — normalize drafted copy + recipients into one campaign object
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * @param {Object} opts
   * @param {string} opts.subject
   * @param {string} opts.html
   * @param {string} [opts.text]
   * @param {string} [opts.replyTo]
   * @param {string} [opts.campaignName]
   * @param {Array<{to:string, toName?:string, mergeFields?:Object}>} opts.recipients
   * @returns {Object} campaign
   */
  function collateCampaign({ subject, html, text, replyTo, campaignName, recipients }) {
    const cleanSubject = (subject || '').trim();
    const cleanHtml     = (html || '').trim();
    const cleanRecipients = (recipients || [])
      .map(r => (typeof r === 'string') ? { to: r.trim() } : { to: (r.to || '').trim(), toName: r.toName, mergeFields: r.mergeFields })
      .filter(r => r.to);

    return {
      id:           'campaign_' + Math.random().toString(36).slice(2, 10),
      campaignName: campaignName || cleanSubject || 'Untitled Campaign',
      subject:      cleanSubject,
      html:         cleanHtml,
      text:         (text || '').trim(),
      replyTo:      replyTo || '',
      recipients:   cleanRecipients,
      createdAt:    Date.now(),
      status:       'draft', // draft -> reviewed -> approved | rejected -> sending -> sent
    };
  }

  /**
   * Parse a pasted recipient list — one per line, formats supported:
   *   email@example.com
   *   Name <email@example.com>
   *   email@example.com, Name, firstName=Sam;company=Acme
   * @param {string} raw
   * @returns {Array<{to, toName, mergeFields}>}
   */
  function parseRecipientList(raw) {
    if (!raw) return [];
    return raw.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const namedMatch = line.match(/^(.*?)<([^>]+)>$/);
      if (namedMatch) {
        return { to: namedMatch[2].trim(), toName: namedMatch[1].trim() || undefined };
      }
      const parts = line.split(',').map(p => p.trim());
      const to = parts[0];
      const toName = parts[1] && !parts[1].includes('=') ? parts[1] : undefined;
      const mergeFields = {};
      parts.slice(1).forEach(p => {
        if (p.includes('=')) {
          const [k, v] = p.split('=');
          if (k && v !== undefined) mergeFields[k.trim()] = v.trim();
        }
      });
      return { to, toName, mergeFields: Object.keys(mergeFields).length ? mergeFields : undefined };
    }).filter(r => r.to);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     REVIEW — Scotty QA pass before anything is allowed to send
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Runs the campaign past Scotty for a compliance/deliverability QA check.
   * @param {Object} campaign — from collateCampaign()
   * @returns {Promise<{approved:boolean, blockers:string[], warnings:string[], summary:string}>}
   */
  async function reviewWithScotty(campaign) {
    if (!window.ClaudeService) throw new Error('Claude API not configured. Add your API key in Settings.');

    const recipientSample = (campaign.recipients || []).slice(0, 5).map(r => r.to).join(', ');
    const mergeTokensUsed = Array.from(new Set(
      (`${campaign.subject}\n${campaign.html}`.match(/\{\{\s*([\w.]+)\s*\}\}/g) || [])
        .map(t => t.replace(/[{}]/g, '').trim())
    ));

    const systemPrompt = `You are Scotty, the AI CMO, acting as the final QA gate before a marketing email campaign is sent to real recipients. You are strict — deliverability, legal exposure, and brand reputation are on the line. You are reviewing copy only; you cannot see rendered output, so flag anything text-inspectable.

Check for:
- Missing or malformed unsubscribe / opt-out language (required for bulk commercial email — CAN-SPAM / GDPR)
- Missing physical sender identification if implied as a commercial newsletter
- Spam-trigger language (ALL CAPS shouting, excessive "!!!", "FREE", "ACT NOW", "$$$", misleading subject lines)
- Unresolved or likely-broken merge tags (e.g. {{firstName}} left in copy with no fallback, or merge tokens that don't look like real fields)
- Overstated/unverifiable claims (guarantees, ROI numbers, "#1", medical/financial claims) that need a disclaimer
- Broken or placeholder links (e.g. "#", "example.com", "TODO", "[link]")
- Missing subject line or empty body
- Recipient list problems visible from the sample given (obviously fake/test addresses like test@test.com mixed into a real send)

Respond ONLY with valid JSON — no markdown fences, no commentary:
{
  "approved": true or false,
  "blockers": ["specific issue that MUST be fixed before send — empty array if none"],
  "warnings": ["non-blocking issue worth a human glance — empty array if none"],
  "summary": "2-3 sentence CMO-level verdict on whether this is safe to send and why"
}

Set approved:false if there is at least one blocker. Minor stylistic nitpicks belong in warnings, not blockers.`;

    const userMessage = `Campaign: ${campaign.campaignName}
Recipient count: ${(campaign.recipients || []).length}
Recipient sample: ${recipientSample || '(none provided)'}
Merge tokens found in copy: ${mergeTokensUsed.join(', ') || '(none)'}
Reply-to: ${campaign.replyTo || '(not set)'}

Subject: ${campaign.subject}

HTML body:
${campaign.html}

${campaign.text ? `Plain text body:\n${campaign.text}` : ''}`;

    const result = await window.ClaudeService.callAgent({
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      model: 'claude-opus-4-7',
    });

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Scotty QA review returned an unexpected format — treat as not approved and retry.');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      approved: !!parsed.approved && (!parsed.blockers || parsed.blockers.length === 0),
      blockers: parsed.blockers || [],
      warnings: parsed.warnings || [],
      summary:  parsed.summary || '',
    };
  }

  /* ─────────────────────────────────────────────────────────────────────────
     SEND — dispatch to /api/send-campaign.js in batches
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * @param {Object} campaign — from collateCampaign(), must have been approved
   * @param {Function} [onBatchComplete] — called with ({batchIndex, batchCount, results}) after each batch
   * @returns {Promise<{sent:number, failed:number, rejected:Array, results:Array}>}
   */
  async function sendCampaign(campaign, onBatchComplete) {
    const recipients = campaign.recipients || [];
    if (recipients.length === 0) throw new Error('No recipients to send to.');
    if (!campaign.subject || !campaign.html) throw new Error('Campaign is missing subject or body.');

    const batches = [];
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      batches.push(recipients.slice(i, i + BATCH_SIZE));
    }

    const aggregate = { sent: 0, failed: 0, rejected: [], results: [] };

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const res = await fetch('/api/send-campaign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject:    campaign.subject,
          html:       campaign.html,
          text:       campaign.text || undefined,
          replyTo:    campaign.replyTo || undefined,
          campaignId: campaign.id,
          recipients: batch,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        aggregate.rejected.push(...batch.map(r => ({ to: r.to, error: data.error || `Batch ${i + 1} failed` })));
        if (onBatchComplete) onBatchComplete({ batchIndex: i, batchCount: batches.length, results: null, error: data.error });
        continue;
      }

      aggregate.sent    += data.sent    || 0;
      aggregate.failed  += data.failed  || 0;
      aggregate.rejected.push(...(data.rejected || []));
      aggregate.results.push(...(data.results || []));

      if (onBatchComplete) onBatchComplete({ batchIndex: i, batchCount: batches.length, results: data });

      // A hard stop mid-campaign (e.g. daily limit hit) — surface remaining recipients as rejected rather than looping forever.
      if (data.dailySent >= data.dailyLimit && i < batches.length - 1) {
        const remaining = batches.slice(i + 1).flat();
        aggregate.rejected.push(...remaining.map(r => ({ to: r.to, error: 'Daily send limit reached before this recipient was reached' })));
        break;
      }
    }

    return aggregate;
  }

  return {
    collateCampaign,
    parseRecipientList,
    reviewWithScotty,
    sendCampaign,
  };
})();

window.EmailDeliveryService = EmailDeliveryService;
