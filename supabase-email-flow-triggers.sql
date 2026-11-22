-- ═══════════════════════════════════════════════════════════════════════════
-- Automatic enrolment for automation flows
-- ═══════════════════════════════════════════════════════════════════════════
-- A flow with trigger 'contact_created' or 'segment_entry' is watched by
-- api/cron-flow-triggers.js, which enrols people as they arrive.
--
--   trigger_checked_at  when the watcher last looked. NULL means "not
--                       baselined yet": on its next run the watcher records
--                       who is already there WITHOUT enrolling them, so
--                       activating a flow never mails the existing audience.
--                       Reset to NULL every time the flow is activated.
--   email_flow_trigger_seen  for 'segment_entry': who was already in the
--                       segment at baseline, or has since been enrolled, so
--                       "entered the segment" fires once per person.
--
-- Safe to run more than once. Run after supabase-email-engine.sql.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE email_flows ADD COLUMN IF NOT EXISTS trigger_checked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_flow_trigger_seen (
  flow_id  UUID        NOT NULL REFERENCES email_flows(id) ON DELETE CASCADE,
  email    TEXT        NOT NULL,
  seen_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (flow_id, email)
);

-- Written only by the service-role watcher; no policies, so no direct client access.
ALTER TABLE email_flow_trigger_seen ENABLE ROW LEVEL SECURITY;
