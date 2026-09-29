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
  function collateCampaign({ subject, html, text, replyTo, campaignName, recipients, companyName, mailingAddress }) {
    const cleanSubject = (subject || '').trim();
    const cleanHtml     = (html || '').trim();
    const cleanRecipients = (recipients || [])
      .map(r => (typeof r === 'string') ? { to: r.trim() } : { to: (r.to || '').trim(), toName: r.toName, mergeFields: r.mergeFields, _contactId: r._contactId })
      .filter(r => r.to);

    return {
      id:             'campaign_' + Math.random().toString(36).slice(2, 10),
      campaignName:   campaignName || cleanSubject || 'Untitled Campaign',
      subject:        cleanSubject,
      html:           cleanHtml,
      text:           (text || '').trim(),
      replyTo:        replyTo || '',
      // Passed through to /api/send-campaign.js, which appends a compliance
      // footer (opt-out language + physical address) to every send that
      // doesn't already have one — this is what makes it use this
      // business's real details instead of falling back to env vars.
      companyName:    companyName || '',
      mailingAddress: mailingAddress || '',
      recipients:     cleanRecipients,
      createdAt:      Date.now(),
      status:         'draft', // draft -> reviewed -> approved | rejected -> sending -> sent
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
      // A field-assignment part can itself carry several fields, semicolon-
      // separated ("firstName=Jane;company=Acme") — this used to split only
      // on the outer comma, so that whole chunk was treated as ONE key=value
      // pair: `p.split('=')` on "firstName=Jane;company=Acme" yields three
      // pieces, and destructuring `[k, v]` silently took "Jane;company" as
      // the value and dropped "company=Acme" entirely. Split each
      // comma-part on ';' first, then take the FIRST '=' in each piece (via
      // indexOf, not split) so a value that itself contains '=' isn't cut short.
      parts.slice(1).forEach(p => {
        if (!p.includes('=')) return;
        p.split(';').forEach(pair => {
          const eqIdx = pair.indexOf('=');
          if (eqIdx === -1) return;
          const k = pair.slice(0, eqIdx).trim();
          const v = pair.slice(eqIdx + 1).trim();
          if (k && v) mergeFields[k] = v;
        });
      });
      return { to, toName, mergeFields: Object.keys(mergeFields).length ? mergeFields : undefined };
    }).filter(r => r.to);
  }

  /**
   * A pasted recipient list is very often just email addresses with no name
   * attached — but the account frequently already has that person as a real
   * contact (imported by Blade, added to Audience Manager, etc) with a real
   * first name on file. Rather than sending them an unpersonalized email
   * (or requiring whoever pasted the list to retype data that already
   * exists), look each address up against the contacts table and fill in
   * whatever it has — without overwriting anything already explicitly
   * supplied in the paste (e.g. `firstName=Jane` in the paste line wins over
   * whatever the contacts table says for that address).
   * @param {Array<{to, toName?, mergeFields?}>} recipients
   * @returns {Promise<Array>} the same recipients, enriched where possible
   */
  async function enrichRecipientsFromContacts(recipients) {
    if (!window.ContactsStore || !recipients || !recipients.length) return recipients;

    let matches;
    try {
      matches = await window.ContactsStore.getContactsByEmail(recipients.map(r => r.to));
    } catch (e) {
      // Enrichment is a nice-to-have on top of a paste that already works —
      // a failed lookup (signed out, RLS hiccup) must not block sending.
      return recipients;
    }
    if (!matches.length) return recipients;

    const byEmail = new Map(matches.map(c => [String(c.email || '').trim().toLowerCase(), c]));
    return recipients.map(r => {
      const contact = byEmail.get(String(r.to || '').trim().toLowerCase());
      if (!contact) return r;
      const mergeFields = { ...(r.mergeFields || {}) };
      if (mergeFields.firstName === undefined && contact.first_name) mergeFields.firstName = contact.first_name;
      if (mergeFields.lastName === undefined && contact.last_name) mergeFields.lastName = contact.last_name;
      if (mergeFields.company === undefined && contact.company) mergeFields.company = contact.company;
      const toName = r.toName || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || undefined;
      return { ...r, toName, mergeFields: Object.keys(mergeFields).length ? mergeFields : undefined };
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     REVIEW — Scotty QA pass before anything is allowed to send
  ───────────────────────────────────────────────────────────────────────── */

  /**
   * Runs the campaign past Scotty for a compliance/deliverability QA check.
   *
   * This is a server call (api/review-campaign.js), not a client-side
   * freehand completion — that endpoint uses a forced tool call
   * (api/_lib/nancy-claude.js's callClaudeForJSON), the same pattern every
   * other structured Claude call in this app uses, so the response is
   * guaranteed valid structured data. The previous client-side version asked
   * the model to freehand a JSON blob (after being told to echo the
   * campaign's own subject/HTML back into its reasoning) and parsed it with
   * a bare regex + JSON.parse() — which failed exactly as reported
   * ("Unterminated string in JSON") whenever the model included a quote or
   * newline in a string field without perfectly escaping it.
   * @param {Object} campaign — from collateCampaign()
   * @returns {Promise<{approved:boolean, blockers:string[], warnings:string[], summary:string}>}
   */
  async function reviewWithScotty(campaign) {
    const res = await fetch('/api/review-campaign', {
      method: 'POST',
      headers: await window.sendAuthHeaders(),
      body: JSON.stringify({
        campaignName: campaign.campaignName,
        recipients:   campaign.recipients,
        replyTo:      campaign.replyTo,
        subject:      campaign.subject,
        html:         campaign.html,
        text:         campaign.text,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Scotty QA review failed.');

    return {
      approved: !!data.approved,
      blockers: data.blockers || [],
      warnings: data.warnings || [],
      summary:  data.summary || '',
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

    const aggregate = { sent: 0, failed: 0, rejected: [], results: [], warnings: [] };

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const res = await fetch('/api/send-campaign', {
        method:  'POST',
        headers: await window.sendAuthHeaders(),
        body: JSON.stringify({
          subject:        campaign.subject,
          html:           campaign.html,
          text:           campaign.text || undefined,
          replyTo:        campaign.replyTo || undefined,
          companyName:    campaign.companyName || undefined,
          mailingAddress: campaign.mailingAddress || undefined,
          campaignId:     campaign.id,
          recipients:     batch,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Unfinished-copy is a property of the template, not this recipient —
        // every remaining batch would fail the exact same way, so surface the
        // specific issues once and stop rather than repeating the same
        // rejection for every recipient across every batch.
        const message = data.code === 'unfinished_content' && Array.isArray(data.issues) && data.issues.length
          ? `${data.error} ${data.issues.join(' ')}`
          : (data.error || `Batch ${i + 1} failed`);
        const remainingInCampaign = data.code === 'unfinished_content' ? batches.slice(i).flat() : batch;
        aggregate.rejected.push(...remainingInCampaign.map(r => ({ to: r.to, error: message })));
        if (onBatchComplete) onBatchComplete({ batchIndex: i, batchCount: batches.length, results: null, error: message });
        if (data.code === 'unfinished_content') break;
        continue;
      }

      aggregate.sent    += data.sent    || 0;
      aggregate.failed  += data.failed  || 0;
      aggregate.rejected.push(...(data.rejected || []));
      aggregate.results.push(...(data.results || []));
      for (const w of (data.warnings || [])) {
        if (!aggregate.warnings.includes(w)) aggregate.warnings.push(w);
      }

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
    enrichRecipientsFromContacts,
    reviewWithScotty,
    sendCampaign,
  };
})();

window.EmailDeliveryService = EmailDeliveryService;
