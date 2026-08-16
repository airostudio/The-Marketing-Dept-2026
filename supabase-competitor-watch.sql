-- Audema Competitor Watch — scheduled/background competitor monitoring for
-- Scout (Competitive Intel).
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Fixes a gap flagged in the 2026 Agent Audit: Scout was fully on-demand —
-- it could research a competitor when asked, but nothing tracked change
-- over time (a real "site changed", "pricing changed" alert like Crayon or
-- Klue). This is the persistent side of that: a user opts a competitor URL
-- into tracking here, api/cron-competitor-watch.js checks it daily, and any
-- detected change (title, meta description, or page content) gets recorded.

CREATE TABLE IF NOT EXISTS competitor_watches (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  url         TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, url)
);

CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  watch_id          UUID        NOT NULL REFERENCES competitor_watches(id) ON DELETE CASCADE,
  title             TEXT,
  meta_description  TEXT,
  content_hash      TEXT,
  fetched_at        TIMESTAMPTZ DEFAULT NOW(),
  error             TEXT
);

CREATE TABLE IF NOT EXISTS competitor_changes (
  id              UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  watch_id        UUID        NOT NULL REFERENCES competitor_watches(id) ON DELETE CASCADE,
  change_type     TEXT        NOT NULL CHECK (change_type IN ('title', 'meta_description', 'content')),
  previous_value  TEXT,
  new_value       TEXT,
  detected_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitor_watches_user       ON competitor_watches (user_id);
CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_watch    ON competitor_snapshots (watch_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_changes_watch      ON competitor_changes (watch_id, detected_at DESC);

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE competitor_watches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_changes   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competitor_watches_owner_all" ON competitor_watches;
CREATE POLICY "competitor_watches_owner_all" ON competitor_watches
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "competitor_snapshots_owner_all" ON competitor_snapshots;
CREATE POLICY "competitor_snapshots_owner_all" ON competitor_snapshots
  FOR ALL USING (
    EXISTS (SELECT 1 FROM competitor_watches w WHERE w.id = watch_id AND w.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "competitor_changes_owner_all" ON competitor_changes;
CREATE POLICY "competitor_changes_owner_all" ON competitor_changes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM competitor_watches w WHERE w.id = watch_id AND w.user_id = auth.uid())
  );

-- Writes to snapshots/changes happen only via the service-role key
-- (api/cron-competitor-watch.js), which bypasses RLS entirely.
