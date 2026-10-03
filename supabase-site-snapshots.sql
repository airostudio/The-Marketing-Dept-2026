-- Audema Site Snapshots — a saved list of client websites, each with a
-- history of screenshots, for before/after comparisons.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-intelligence-profiles.sql already run (for sharing).
--
-- Every screenshot/crawl tool in this app already works against any real
-- public website — api/_lib/safe-fetch.js's SSRF protection only blocks
-- private/internal addresses, never a client's real domain. What didn't
-- exist was a place to KEEP a client site on hand and re-shoot it over
-- time: "take a screenshot of this client's site now, take another one
-- after we rebuild it, show them side by side." This is that list.

CREATE TABLE IF NOT EXISTS site_watchlist (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intel_profile_id  UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,
  client_name       TEXT        NOT NULL,
  url               TEXT        NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_watchlist_user    ON site_watchlist (user_id);
CREATE INDEX IF NOT EXISTS idx_site_watchlist_profile ON site_watchlist (intel_profile_id);

CREATE TABLE IF NOT EXISTS site_snapshots (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  watchlist_id  UUID        NOT NULL REFERENCES site_watchlist(id) ON DELETE CASCADE,
  -- Free text, not an enum: 'before'/'after' covers the common case, but a
  -- client whose site is reshot every month needs more than two labels.
  label         TEXT        NOT NULL DEFAULT 'before',
  hosted_url    TEXT        NOT NULL,
  mime_type     TEXT        NOT NULL DEFAULT 'image/png',
  captured_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_snapshots_watchlist ON site_snapshots (watchlist_id, captured_at DESC);

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE site_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_watchlist_owner_all" ON site_watchlist;
CREATE POLICY "site_watchlist_owner_all" ON site_watchlist
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Same profile-sharing pattern as contacts/segments/campaign_sends — see
-- supabase-team-access-extend.sql. Viewers can see a client's screenshot
-- history; only the owner or an editor can add a client or take a new shot.
DROP POLICY IF EXISTS "site_watchlist_profile_access" ON site_watchlist;
CREATE POLICY "site_watchlist_profile_access" ON site_watchlist
  FOR SELECT USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "site_watchlist_profile_edit" ON site_watchlist;
CREATE POLICY "site_watchlist_profile_edit" ON site_watchlist
  FOR ALL USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'editor'))
    )
  ) WITH CHECK (
    intel_profile_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = intel_profile_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                 WHERE m.profile_id = intel_profile_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'editor'))
    )
  );

DROP POLICY IF EXISTS "site_snapshots_owner_all" ON site_snapshots;
CREATE POLICY "site_snapshots_owner_all" ON site_snapshots
  FOR ALL USING (
    EXISTS (SELECT 1 FROM site_watchlist w WHERE w.id = watchlist_id AND w.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM site_watchlist w WHERE w.id = watchlist_id AND w.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "site_snapshots_profile_read" ON site_snapshots;
CREATE POLICY "site_snapshots_profile_read" ON site_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_watchlist w
      WHERE w.id = watchlist_id AND w.intel_profile_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = w.intel_profile_id AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                   WHERE m.profile_id = w.intel_profile_id AND m.user_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "site_snapshots_profile_edit" ON site_snapshots;
CREATE POLICY "site_snapshots_profile_edit" ON site_snapshots
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM site_watchlist w
      WHERE w.id = watchlist_id AND w.intel_profile_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = w.intel_profile_id AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                   WHERE m.profile_id = w.intel_profile_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'editor'))
      )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_watchlist w
      WHERE w.id = watchlist_id AND w.intel_profile_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM intelligence_profiles p WHERE p.id = w.intel_profile_id AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM intelligence_profile_members m
                   WHERE m.profile_id = w.intel_profile_id AND m.user_id = auth.uid() AND m.role IN ('owner', 'editor'))
      )
    )
  );
