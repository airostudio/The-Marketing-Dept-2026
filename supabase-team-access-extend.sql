-- Audema Team Access — extend profile-sharing to Pat's campaign/automation
-- tables.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-intelligence-profiles.sql, supabase-audience.sql and
--           supabase-email-engine.sql have already been run.
--
-- The intelligence_profile_members sharing model (one business, several
-- logins, owner/editor/viewer roles — see supabase-intelligence-profiles.sql
-- and api/profile-members.js) already reaches contacts, segments and
-- social_posts. It stops there: campaign_sends (the send log), the A/B
-- testing tables, automation flows, and revenue attribution are all still
-- owner-only — a teammate invited onto a shared profile can see the
-- audience and drafted content, but not whether a campaign actually sent,
-- how a split test is doing, or what an automation is enrolling people
-- into. This closes that gap using the exact same pattern already proven
-- on contacts/segments: an intel_profile_id column, direct policies on
-- the tables that have one, and EXISTS-chained policies on the child
-- tables that don't (email_ab_variants/assignments via test_id,
-- email_flow_steps/enrolments via flow_id) — mirroring how
-- segment_members already reaches through segments' intel_profile_id.
--
-- Nothing here removes the existing owner-only policies — a row with no
-- intel_profile_id (never shared) still works exactly as before.

-- ── New columns ──────────────────────────────────────────────────────────
ALTER TABLE campaign_sends    ADD COLUMN IF NOT EXISTS intel_profile_id UUID REFERENCES intelligence_profiles(id) ON DELETE CASCADE;
ALTER TABLE email_ab_tests    ADD COLUMN IF NOT EXISTS intel_profile_id UUID REFERENCES intelligence_profiles(id) ON DELETE CASCADE;
ALTER TABLE email_flows       ADD COLUMN IF NOT EXISTS intel_profile_id UUID REFERENCES intelligence_profiles(id) ON DELETE CASCADE;
ALTER TABLE email_conversions ADD COLUMN IF NOT EXISTS intel_profile_id UUID REFERENCES intelligence_profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_campaign_sends_profile    ON campaign_sends    (intel_profile_id);
CREATE INDEX IF NOT EXISTS idx_ab_tests_profile          ON email_ab_tests    (intel_profile_id);
CREATE INDEX IF NOT EXISTS idx_email_flows_profile       ON email_flows       (intel_profile_id);
CREATE INDEX IF NOT EXISTS idx_email_conversions_profile ON email_conversions (intel_profile_id);

-- ── campaign_sends ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "campaign_sends_profile_access" ON campaign_sends;
CREATE POLICY "campaign_sends_profile_access" ON campaign_sends
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner', 'editor'))
    )
  );

-- ── A/B testing: tests directly, variants/assignments chained through test_id ──
DROP POLICY IF EXISTS "ab_tests_profile_access" ON email_ab_tests;
CREATE POLICY "ab_tests_profile_access" ON email_ab_tests
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner', 'editor'))
    )
  );

DROP POLICY IF EXISTS "ab_variants_profile_access" ON email_ab_variants;
CREATE POLICY "ab_variants_profile_access" ON email_ab_variants
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM email_ab_tests t
      WHERE t.id = test_id AND t.intel_profile_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = t.intel_profile_id AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                   WHERE m.profile_id = t.intel_profile_id AND m.user_id = auth.uid()
                     AND m.role IN ('owner', 'editor'))
      )
    )
  );

-- Read-only for members, same as ab_assignments_owner_read — an assignment
-- is a send-time fact, not something a teammate should hand-edit.
DROP POLICY IF EXISTS "ab_assignments_profile_read" ON email_ab_assignments;
CREATE POLICY "ab_assignments_profile_read" ON email_ab_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM email_ab_tests t
      WHERE t.id = test_id AND t.intel_profile_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = t.intel_profile_id AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                   WHERE m.profile_id = t.intel_profile_id AND m.user_id = auth.uid())
      )
    )
  );

-- ── Automation flows: flows directly, steps/enrolments chained through flow_id ──
DROP POLICY IF EXISTS "flows_profile_access" ON email_flows;
CREATE POLICY "flows_profile_access" ON email_flows
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p
              WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid()
                   AND m.role IN ('owner', 'editor'))
    )
  );

DROP POLICY IF EXISTS "flow_steps_profile_access" ON email_flow_steps;
CREATE POLICY "flow_steps_profile_access" ON email_flow_steps
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM email_flows f
      WHERE f.id = flow_id AND f.intel_profile_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = f.intel_profile_id AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                   WHERE m.profile_id = f.intel_profile_id AND m.user_id = auth.uid()
                     AND m.role IN ('owner', 'editor'))
      )
    )
  );

-- Read-only for members, same as flow_enrolments_owner_read — who is
-- currently mid-sequence is a fact the automation produced, not something
-- a teammate should hand-edit.
DROP POLICY IF EXISTS "flow_enrolments_profile_read" ON email_flow_enrolments;
CREATE POLICY "flow_enrolments_profile_read" ON email_flow_enrolments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM email_flows f
      WHERE f.id = flow_id AND f.intel_profile_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = f.intel_profile_id AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                   WHERE m.profile_id = f.intel_profile_id AND m.user_id = auth.uid())
      )
    )
  );

-- ── Revenue attribution: read-only for members, same as conversions_owner_read ──
-- Reported revenue numbers are facts a webhook recorded, not something a
-- teammate should be able to alter.
DROP POLICY IF EXISTS "conversions_profile_read" ON email_conversions;
CREATE POLICY "conversions_profile_read" ON email_conversions
  FOR SELECT USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid())
    )
  );
