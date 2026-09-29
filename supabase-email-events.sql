-- Audema email engagement events — what actually happened to each send.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: database/supabase-schema.sql (profiles) and supabase-audience.sql
--           (contacts) already run.
--
-- Until now api/resend-webhook.js handled only bounces and complaints, so
-- opens and clicks were never recorded anywhere. Every campaign therefore
-- reported "0.0% open rate", which a customer reads as "nobody opened it"
-- when the truth was that nothing was counted. api/send-campaign.js already
-- tags every send with campaign_id and contact_id, so the attribution has
-- been available all along — there was just nowhere to put the result.

CREATE TABLE IF NOT EXISTS email_events (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id      UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id  TEXT,
  contact_id   UUID,
  -- Resend's own event vocabulary, minus the prefix.
  event_type   TEXT        NOT NULL,
  email_id     TEXT,
  recipient    TEXT,
  -- The clicked URL for a click event; null otherwise.
  link_url     TEXT,
  -- Resend's event timestamp, not our insert time: events can arrive late or
  -- out of order, and "when it happened" is the useful axis.
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT email_events_type_valid CHECK (event_type IN
    ('sent','delivered','delivery_delayed','opened','clicked','bounced','complained'))
);

-- One row per (email, event type, moment). Resend retries a webhook until it
-- gets a 200, so the same open can legitimately arrive several times; without
-- this a retry would inflate the open count. A genuine second open by the same
-- person has a different occurred_at and is still counted, which is correct —
-- "opens" is opens, not unique openers (see uniq_opens in the stats endpoint).
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_events_dedupe
  ON email_events (email_id, event_type, occurred_at)
  WHERE email_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_events_campaign
  ON email_events (campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_user
  ON email_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_contact
  ON email_events (contact_id, occurred_at DESC);

-- ── Per-campaign aggregate ─────────────────────────────────────────────────
-- Counting in Postgres rather than shipping every event row to the browser to
-- be tallied. A busy campaign is hundreds of thousands of rows.
--
-- Returns opens AND unique openers, because they answer different questions
-- and a single "opens" figure gets read as whichever the reader assumed.
CREATE OR REPLACE FUNCTION campaign_email_stats(cid TEXT, uid UUID)
RETURNS TABLE (
  sent BIGINT, delivered BIGINT, opened BIGINT, unique_opened BIGINT,
  clicked BIGINT, unique_clicked BIGINT, bounced BIGINT, complained BIGINT,
  first_event TIMESTAMPTZ, last_event TIMESTAMPTZ
) AS $$
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'sent'),
    COUNT(*) FILTER (WHERE event_type = 'delivered'),
    COUNT(*) FILTER (WHERE event_type = 'opened'),
    COUNT(DISTINCT email_id) FILTER (WHERE event_type = 'opened'),
    COUNT(*) FILTER (WHERE event_type = 'clicked'),
    COUNT(DISTINCT email_id) FILTER (WHERE event_type = 'clicked'),
    COUNT(*) FILTER (WHERE event_type = 'bounced'),
    COUNT(*) FILTER (WHERE event_type = 'complained'),
    MIN(occurred_at),
    MAX(occurred_at)
  FROM email_events
  WHERE campaign_id = cid AND (uid IS NULL OR user_id = uid);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── Row-Level Security ─────────────────────────────────────────────────────
-- Written only by api/resend-webhook.js with the service-role key. Customers
-- read their own events so the dashboard can show their own campaigns.
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_events_self_read" ON email_events;
CREATE POLICY "email_events_self_read" ON email_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "email_events_admin_read" ON email_events;
CREATE POLICY "email_events_admin_read" ON email_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin'))
  );

-- Deliberately no INSERT/UPDATE/DELETE policy: engagement figures a client
-- could write are not engagement figures.

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTER RUNNING THIS: open tracking must also be switched on at Resend.
--
--   Resend Dashboard → Domains → <your domain> → enable Open Tracking and
--   Click Tracking, and Webhooks → your endpoint → subscribe to
--   email.sent, email.delivered, email.opened, email.clicked,
--   email.bounced, email.complained.
--
-- Without those, Resend never emits open or click events and this table stays
-- empty. api/campaign-stats.js reports that state as "not tracked" rather than
-- as a 0% open rate, so an unconfigured account is never told nobody opened
-- its mail.
-- ═══════════════════════════════════════════════════════════════════════════
