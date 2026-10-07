/**
 * flow-builder.js — the pure logic behind the "New automation flow" screen
 * (web/marketing/email-marketing.html): turning what a person typed into the
 * payload api/email-flows.js expects, and turning a segment's contacts into
 * the recipients to enrol. No DOM in here, so it can be tested.
 *
 * The server (api/_lib/flow-merge.js) is the authority on whether copy can be
 * sent; this only catches the obvious mistakes before a round trip.
 */
(function (root) {
  'use strict';

  const MAX_STEPS = 20;           // keep in step with api/email-flows.js
  const MAX_ENROL = 500;          // per click — enrolment is one request per person

  /** Merge tags offered as insert buttons. Each already carries a fallback. */
  const TAGS = [
    { label: 'First name', tag: '{{firstName|there}}' },
    { label: 'Company', tag: '{{company|your business}}' },
    { label: 'Area', tag: '{{area|your area}}' },
    { label: 'Sender name', tag: '{{senderName}}' },
    { label: 'Sender title', tag: '{{senderTitle}}' },
    { label: 'Sender company', tag: '{{senderCompany}}' },
  ];

  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** Plain text → simple HTML: blank-line paragraphs, single newlines as <br>. */
  function textToHtml(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
      .map(p => p.trim()).filter(Boolean)
      .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  }

  /**
   * @param {{name, trigger?, segmentId?, fromName?, fromEmail?, steps: Array<{delayHours, subject, body}>}} form
   * @param {{senderFields?: object, intelProfileId?: string}} [opts]
   * @returns {{errors: string[], payload?: object}}
   */
  function buildCreatePayload(form, opts) {
    const o = opts || {};
    const errors = [];
    const name = String(form.name || '').trim();
    if (!name) errors.push('Give the flow a name.');
    const steps = Array.isArray(form.steps) ? form.steps : [];
    if (!steps.length) errors.push('Add at least one email.');
    if (steps.length > MAX_STEPS) errors.push(`A flow can have at most ${MAX_STEPS} emails.`);

    const out = steps.map((s, i) => {
      const subject = String(s.subject || '').trim();
      const html = textToHtml(s.body);
      const delay = Number(s.delayHours);
      if (!subject) errors.push(`Email ${i + 1} needs a subject.`);
      if (!html) errors.push(`Email ${i + 1} needs some content.`);
      if (!(delay >= 0)) errors.push(`Email ${i + 1} has an invalid delay.`);
      return { delayHours: delay >= 0 ? Math.floor(delay) : 0, subject, html };
    });
    if (errors.length) return { errors };

    const trigger = ['manual', 'contact_created', 'segment_entry'].includes(form.trigger) ? form.trigger : 'manual';
    if (trigger === 'segment_entry' && !form.segmentId) errors.push('Choose which segment this flow watches.');
    if (errors.length) return { errors };

    const payload = { action: 'create', name, triggerType: trigger, steps: out };
    if (trigger === 'segment_entry') payload.segmentId = form.segmentId;
    if (form.fromName && String(form.fromName).trim()) payload.fromName = String(form.fromName).trim();
    if (form.fromEmail && String(form.fromEmail).trim()) payload.fromEmail = String(form.fromEmail).trim();
    if (o.senderFields && Object.keys(o.senderFields).length) payload.senderFields = o.senderFields;
    if (o.intelProfileId) payload.intelProfileId = o.intelProfileId;
    return { errors: [], payload };
  }

  /**
   * Contacts → enrolment recipients. Only subscribed contacts with an email;
   * duplicates dropped; capped. The server and the sender re-check
   * suppression regardless — this just avoids sending known opt-outs there.
   */
  function enrolRecipients(contacts) {
    const seen = new Set();
    const out = [];
    let skipped = 0;
    for (const c of contacts || []) {
      const email = String((c && c.email) || '').trim();
      const key = email.toLowerCase();
      if (!email || seen.has(key) || (c.status && c.status !== 'subscribed')) { skipped++; continue; }
      seen.add(key);
      out.push({ email, contactId: c.id || undefined });
    }
    const capped = out.length > MAX_ENROL;
    return { recipients: out.slice(0, MAX_ENROL), skipped, capped, total: out.length };
  }

  const TRIGGER_LABELS = {
    manual: 'Manual — you enrol people',
    contact_created: 'Automatic — whenever a new contact is added',
    segment_entry: 'Automatic — whenever someone joins a segment',
  };

  const api = { TRIGGER_LABELS, MAX_STEPS, MAX_ENROL, TAGS, textToHtml, buildCreatePayload, enrolRecipients };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlowBuilder = api;
})(typeof window !== 'undefined' ? window : globalThis);
