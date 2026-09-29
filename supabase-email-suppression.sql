-- Audema email suppression and per-account send quota.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-audience.sql (contacts) already run.
--
-- Two gaps the Email Delivery audit found, both in the one code path that
-- actually calls Resend.
--
-- 1. Suppression was only ever enforced in the browser. api/send-campaign.js
--    took the recipient list on trust and never checked whether any of those
--    people had opted out. The client-side filter it relied on
--    (resolveSegmentContacts) honours the segment's own filter_rules.status,
--    so a segment configured to select unsubscribed contacts would hand them
--    straight to the sender. Suppression belongs on the server, in the last
--    place before the message leaves.
--
-- 2. Unsubscribe was keyed on contact_id. A recipient who had been pasted in
--    ad hoc had no contact row, so clicking unsubscribe recorded nothing —
--    while the confirmation page told them they would not be emailed again.
--    Keying on the address instead means the promise holds for everyone,
--    including people who are not in the CRM.

-- ═══════════════════════════════════════════════════════════════════════════
-- SUPPRESSION LIST
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_suppressions (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Lower-cased at write time by normalise_suppression_email() below. An
  -- address that suppresses only in the casing it happened to arrive in is
  -- not suppressed.
  email       TEXT        NOT NULL,
  reason      TEXT        NOT NULL DEFAULT 'unsubscribed',
  -- Free text: which campaign or import this came from, for answering
  -- "why is this person suppressed" months later.
  source      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT suppression_reason_valid
    CHECK (reason IN ('unsubscribed','bounced','complained','manual'))
);

-- One suppression per address per account. A second unsubscribe from the same
-- person is not an error and must not fail their request.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppressions
  ON email_suppressions (user_id, email);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_email
  ON email_suppressions (email);

-- Case- and whitespace-insensitive by construction rather than by every
-- caller remembering. "Alice@Example.com " and "alice@example.com" are the
-- same person, and a suppression that missed that would mail them anyway.
CREATE OR REPLACE FUNCTION normalise_suppression_email()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email = lower(btrim(NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalise_suppression ON email_suppressions;
CREATE TRIGGER trg_normalise_suppression
  BEFORE INSERT OR UPDATE ON email_suppressions
  FOR EACH ROW EXECUTE FUNCTION normalise_suppression_email();

/**
 * Which of these addresses must NOT be sent to.
 *
 * Answers in one round trip for a whole batch. Checking per recipient would
 * be a query per address, and a send of 500 would either be slow enough to
 * hit the function timeout or get skipped under load — and a suppression
 * check that gets skipped under load is not a suppression check.
 *
 * Covers both the suppression list and contacts whose status says they are
 * not sendable, because either is sufficient reason to withhold a message and
 * the two can legitimately disagree (a contact marked bounced by the webhook
 * may never have been added to the suppression list, and vice versa).
 */
CREATE OR REPLACE FUNCTION suppressed_emails(uid UUID, addresses TEXT[])
RETURNS TABLE (email TEXT, reason TEXT) AS $$
  SELECT s.email, s.reason
    FROM email_suppressions s
   WHERE s.user_id = uid
     AND s.email = ANY (SELECT lower(btrim(a)) FROM unnest(addresses) AS a)
  UNION
  SELECT lower(btrim(c.email)), c.status
    FROM contacts c
   WHERE c.user_id = uid
     AND c.status <> 'subscribed'
     AND lower(btrim(c.email)) = ANY (SELECT lower(btrim(a)) FROM unnest(addresses) AS a);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Keep the two in step: when the webhook or a manual edit marks a contact
-- bounced or complained, that address is suppressed for every future send,
-- including ad-hoc ones that never look at the contacts table.
CREATE OR REPLACE FUNCTION sync_contact_suppression()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('unsubscribed','bounced','complained') THEN
    INSERT INTO email_suppressions (user_id, email, reason, source)
    VALUES (NEW.user_id, NEW.email, NEW.status, 'contact status change')
    ON CONFLICT (user_id, email) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_contact_suppression ON contacts;
CREATE TRIGGER trg_contact_suppression
  AFTER INSERT OR UPDATE OF status ON contacts
  FOR EACH ROW EXECUTE FUNCTION sync_contact_suppression();

-- Backfill: anyone already opted out must be on the list from the moment this
-- migration runs, not only from their next status change.
INSERT INTO email_suppressions (user_id, email, reason, source)
SELECT user_id, lower(btrim(email)), status, 'backfill from contacts'
  FROM contacts
 WHERE status IN ('unsubscribed','bounced','complained')
ON CONFLICT (user_id, email) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- PER-ACCOUNT DAILY SEND QUOTA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The limit was a module-level counter in api/send-campaign.js: shared by
-- every customer on the deployment, and reset on every cold start. So one
-- account's sending consumed everybody's budget, while each serverless
-- instance kept its own tally and the real ceiling was whatever the current
-- instance count happened to be. It was simultaneously too strict and too
-- loose to be a safety rail.

CREATE TABLE IF NOT EXISTS email_send_quota (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day         DATE        NOT NULL,
  sent        INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT send_quota_nonneg CHECK (sent >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_send_quota ON email_send_quota (user_id, day);

-- Admin-settable override, same shape as mission_limit: an account with a
-- warmed sending reputation should not be held to the starter ceiling.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_send_limit INTEGER;

/**
 * Claim n sends against today's quota, atomically.
 *
 * Returns how many were actually granted, which may be fewer than asked for
 * when the budget is nearly spent. Read-then-write from the API would let two
 * concurrent sends both see the same remaining budget and both spend it.
 */
CREATE OR REPLACE FUNCTION claim_send_quota(uid UUID, want INTEGER, cap INTEGER)
RETURNS INTEGER AS $$
DECLARE
  used INTEGER;
  granted INTEGER;
BEGIN
  INSERT INTO email_send_quota (user_id, day, sent)
  VALUES (uid, CURRENT_DATE, 0)
  ON CONFLICT (user_id, day) DO NOTHING;

  SELECT sent INTO used FROM email_send_quota
   WHERE user_id = uid AND day = CURRENT_DATE FOR UPDATE;

  granted := LEAST(want, GREATEST(cap - used, 0));

  IF granted > 0 THEN
    UPDATE email_send_quota SET sent = sent + granted, updated_at = NOW()
     WHERE user_id = uid AND day = CURRENT_DATE;
  END IF;

  RETURN granted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Row-Level Security ─────────────────────────────────────────────────────
ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_send_quota   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppressions_owner_read" ON email_suppressions;
CREATE POLICY "suppressions_owner_read" ON email_suppressions
  FOR SELECT USING (auth.uid() = user_id);

-- Adding a suppression from the browser is fine — that is "do not email this
-- person", which is only ever safe. There is deliberately no DELETE policy:
-- removing someone from a suppression list is re-subscribing them on their
-- behalf, and that needs their action, not the sender's.
DROP POLICY IF EXISTS "suppressions_owner_insert" ON email_suppressions;
CREATE POLICY "suppressions_owner_insert" ON email_suppressions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "send_quota_owner_read" ON email_send_quota;
CREATE POLICY "send_quota_owner_read" ON email_send_quota
  FOR SELECT USING (auth.uid() = user_id);

-- No write policy on the quota: an account that could edit its own counter
-- has no counter.

-- DONE! Suppression is now enforceable server-side and quotas are per account.
