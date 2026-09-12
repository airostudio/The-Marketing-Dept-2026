-- Audema System Failures — every failure in the product, in one place, with
-- someone told about it.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- ── Why this exists ─────────────────────────────────────────────────────────
--
-- This codebase has spent a lot of effort making failures HONEST: a PageSpeed
-- scan that cannot run now shows no score and says what failed, instead of a
-- fabricated 15/100. That is right for the customer, and it is only half the
-- job — because the customer now sees a truthful "this did not work" and
-- nobody who could fix it ever hears about it. An API key expires on a Tuesday
-- and the product quietly degrades until someone complains.
--
-- So every failure is recorded here, grouped, counted, and surfaced to an
-- administrator with what is known about repairing it.
--
-- ── Grouping ────────────────────────────────────────────────────────────────
--
-- Failures arrive in floods: one expired key is not one incident, it is every
-- request until it is fixed. Rows are keyed by a FINGERPRINT — source, kind
-- and a normalised message with ids, urls and numbers stripped — so a flood
-- becomes one row with an occurrence count and a last_seen. That is what makes
-- the list readable enough to act on, and what makes alerting possible without
-- sending ten thousand emails.

CREATE TABLE IF NOT EXISTS system_failures (
  id             UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,

  -- Stable across every occurrence of the same underlying problem.
  fingerprint    TEXT        NOT NULL UNIQUE,

  -- Where it happened: 'api/pagespeed', 'web/seo-pulse.html', 'cron-grant-watch'.
  source         TEXT        NOT NULL,

  -- What kind of thing broke. Deliberately coarse — this is for triage, and a
  -- taxonomy nobody can remember gets filled in wrongly.
  kind           TEXT        NOT NULL
                             CHECK (kind IN (
                               'config_missing',      -- an env var/key is not set
                               'upstream_error',      -- a third party answered badly
                               'upstream_timeout',    -- a third party did not answer
                               'database_error',      -- our own storage refused
                               'unhandled_exception', -- code threw where it should not
                               'client_error',        -- something broke in the browser
                               'integration_failure'  -- a connected account stopped working
                             )),

  severity       TEXT        NOT NULL DEFAULT 'error'
                             CHECK (severity IN ('info', 'warning', 'error', 'critical')),

  message        TEXT        NOT NULL,
  -- Status codes, upstream name, a truncated stack — whatever helps diagnose.
  -- Never request bodies or credentials; see api/_lib/report-failure.js.
  detail         JSONB       DEFAULT '{}',

  -- What is known about fixing it, written for whoever reads the console at
  -- 9am. Null when the cause is not one we recognise.
  remedy         TEXT,

  -- Whether the system can repair this without a person. Set by the reporter
  -- for causes with a known automatic recovery; see recovery_action.
  self_healing   BOOLEAN     NOT NULL DEFAULT FALSE,
  recovery_action TEXT,

  occurrences    INTEGER     NOT NULL DEFAULT 1,
  affected_users INTEGER     NOT NULL DEFAULT 0,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  status         TEXT        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'acknowledged', 'resolved')),
  resolved_at    TIMESTAMPTZ,
  resolved_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  note           TEXT,

  -- Alerting state. notified_at is the cooldown anchor: an incident that is
  -- still happening should not send an email every thirty seconds.
  notified_at    TIMESTAMPTZ,
  notify_count   INTEGER     NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- The console reads open incidents newest-first; the alerter reads by
-- notified_at. Both want an index.
CREATE INDEX IF NOT EXISTS idx_system_failures_open
  ON system_failures (status, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_system_failures_source
  ON system_failures (source, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_system_failures_notify
  ON system_failures (status, severity, notified_at);

-- ── Individual occurrences ──────────────────────────────────────────────────
-- The grouped row says how often and how recently; this says who and exactly
-- what, for the handful of cases where the group is not enough to diagnose.
-- Capped by a retention sweep in the recorder, because this table grows with
-- traffic and the grouped row is what actually gets read.
CREATE TABLE IF NOT EXISTS system_failure_events (
  id           UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  failure_id   UUID        NOT NULL REFERENCES system_failures(id) ON DELETE CASCADE,
  user_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  message      TEXT,
  detail       JSONB       DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_failure_events_failure
  ON system_failure_events (failure_id, occurred_at DESC);

-- ── Recording one failure, atomically ───────────────────────────────────────
--
-- Same lesson as the metering counters elsewhere in this schema: a read, a
-- comparison in JavaScript, and a write is three steps, and failures arrive
-- concurrently by their nature — a broken upstream breaks for everybody at
-- once. This is one statement, so a flood produces one row with a correct
-- count rather than a race between many.
--
-- Returns the incident id and whether this call is what created it. The caller
-- uses is_new to decide whether to alert, so that decision is made on a value
-- the database produced rather than on a separate lookup that could race.
CREATE OR REPLACE FUNCTION record_system_failure(
  p_fingerprint     TEXT,
  p_source          TEXT,
  p_kind            TEXT,
  p_severity        TEXT,
  p_message         TEXT,
  p_detail          JSONB   DEFAULT '{}',
  p_remedy          TEXT    DEFAULT NULL,
  p_self_healing    BOOLEAN DEFAULT FALSE,
  p_recovery_action TEXT    DEFAULT NULL,
  p_user_id         UUID    DEFAULT NULL
)
RETURNS TABLE (failure_id UUID, is_new BOOLEAN, occurrences INTEGER, alert_due BOOLEAN) AS $$
DECLARE
  v_id     UUID;
  v_new    BOOLEAN := FALSE;
  v_count  INTEGER;
  v_status TEXT;
  v_notified TIMESTAMPTZ;
  v_sev    TEXT;
BEGIN
  INSERT INTO system_failures AS f (
    fingerprint, source, kind, severity, message, detail,
    remedy, self_healing, recovery_action, occurrences, first_seen, last_seen
  )
  VALUES (
    p_fingerprint, p_source, p_kind, p_severity, p_message, COALESCE(p_detail, '{}'),
    p_remedy, COALESCE(p_self_healing, FALSE), p_recovery_action, 1, NOW(), NOW()
  )
  ON CONFLICT (fingerprint) DO UPDATE SET
    occurrences = f.occurrences + 1,
    last_seen   = NOW(),
    -- The newest occurrence's detail is the most useful one to keep.
    message     = EXCLUDED.message,
    detail      = EXCLUDED.detail,
    -- Severity only ever climbs within an incident: a problem that was a
    -- warning once and critical since is critical.
    severity    = CASE
                    WHEN EXCLUDED.severity = 'critical' THEN 'critical'
                    WHEN f.severity = 'critical' THEN 'critical'
                    WHEN EXCLUDED.severity = 'error' OR f.severity = 'error' THEN 'error'
                    WHEN EXCLUDED.severity = 'warning' OR f.severity = 'warning' THEN 'warning'
                    ELSE 'info'
                  END,
    -- A resolved incident that happens again is not resolved.
    status      = CASE WHEN f.status = 'resolved' THEN 'open' ELSE f.status END,
    resolved_at = CASE WHEN f.status = 'resolved' THEN NULL ELSE f.resolved_at END
  RETURNING f.id, f.occurrences, f.status, f.notified_at, f.severity
       INTO v_id, v_count, v_status, v_notified, v_sev;

  v_new := (v_count = 1);

  INSERT INTO system_failure_events (failure_id, user_id, message, detail)
  VALUES (v_id, p_user_id, p_message, COALESCE(p_detail, '{}'));

  -- How many distinct people have hit this. Cheap enough at these volumes and
  -- it is the number that says whether an incident matters.
  UPDATE system_failures
     SET affected_users = (
       SELECT COUNT(DISTINCT e.user_id) FROM system_failure_events e
        WHERE e.failure_id = v_id AND e.user_id IS NOT NULL)
   WHERE id = v_id;

  RETURN QUERY SELECT
    v_id,
    v_new,
    v_count,
    -- Alert when it is new, or when it is still happening an hour after the
    -- last alert. Acknowledged and resolved incidents stay quiet: somebody has
    -- already seen them.
    (v_status = 'open'
     AND v_sev IN ('error', 'critical')
     AND (v_notified IS NULL OR v_notified < NOW() - INTERVAL '1 hour'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Mark that an alert went out. Separate from recording, because the alert can
-- fail and must not then look like it was sent.
CREATE OR REPLACE FUNCTION mark_failure_notified(p_failure_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE system_failures
     SET notified_at = NOW(), notify_count = notify_count + 1
   WHERE id = p_failure_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Retention ───────────────────────────────────────────────────────────────
-- The grouped rows are small and worth keeping. The per-occurrence events grow
-- with traffic, and beyond the most recent few per incident they answer no
-- question anybody asks.
CREATE OR REPLACE FUNCTION prune_failure_events(p_keep_per_incident INTEGER DEFAULT 50,
                                                p_max_age_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  removed INTEGER;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY failure_id ORDER BY occurred_at DESC) AS rn,
           occurred_at
      FROM system_failure_events
  )
  DELETE FROM system_failure_events e
   USING ranked r
   WHERE e.id = r.id
     AND (r.rn > p_keep_per_incident
          OR r.occurred_at < NOW() - (p_max_age_days || ' days')::INTERVAL);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Failure detail is operational information about the platform: which upstream
-- is down, which key is unset, what a stack trace says. It is for
-- administrators, not for customers, and never for the anonymous key.
-- Everything is written by the service role through the functions above.
ALTER TABLE system_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_failure_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_failures_admin_read" ON system_failures;
CREATE POLICY "system_failures_admin_read" ON system_failures
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p
             WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin'))
  );

DROP POLICY IF EXISTS "system_failure_events_admin_read" ON system_failure_events;
CREATE POLICY "system_failure_events_admin_read" ON system_failure_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p
             WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin'))
  );

-- Deliberately no INSERT/UPDATE/DELETE policy on either table. A client that
-- could write here could bury an incident, or manufacture one — and the whole
-- point of this table is that what it says happened, happened.

-- DONE! Failures are now recorded, grouped, and alertable.
