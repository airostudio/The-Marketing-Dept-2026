-- Audema Video Gallery — cloud persistence for Reel's generated videos.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- The gallery lived in localStorage only ('reel_videos_v1'), so a customer's
-- generated videos existed on one browser on one machine. Clearing site data
-- destroyed the record, a second device never saw it, and a colleague on the
-- same account got an empty gallery.
--
-- That mattered more here than for most local stores, because a row can be the
-- only handle on work in progress: while Seedance renders, the task id lives
-- in this record and nowhere else. Lose the record and a render the customer
-- has already paid for becomes unreachable — there is no way to ask "is it
-- done yet" without the task id.
--
-- Same dual project/intel_profile scope model and RLS pattern as
-- competitive_roster, analytics_reports and contacts.

CREATE TABLE IF NOT EXISTS video_generations (
  id               UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       UUID        REFERENCES projects(id) ON DELETE CASCADE,
  intel_profile_id UUID        REFERENCES intelligence_profiles(id) ON DELETE CASCADE,

  -- The id the page generated (crypto.randomUUID). Kept as the identity so a
  -- record already referenced elsewhere — a social post's metadata.videoGenId
  -- — keeps pointing at the right video after the lift from localStorage.
  client_id        TEXT        NOT NULL,

  prompt           TEXT        NOT NULL DEFAULT '',
  mode             TEXT        NOT NULL DEFAULT 'text-to-video',
  image_url        TEXT,
  aspect_ratio     TEXT        NOT NULL DEFAULT '16:9',
  duration         INTEGER     NOT NULL DEFAULT 5,
  resolution       TEXT        NOT NULL DEFAULT '1080p',

  -- The provider's task id. This is the handle on an in-flight render; without
  -- it a generation in progress cannot be polled again from anywhere.
  task_id          TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  video_url        TEXT,
  thumbnail_url    TEXT,

  -- 'permanent' once the file has been mirrored into our own storage,
  -- 'temporary' while the only link is the generator's own expiring one. Kept
  -- server-side so the warning survives a device change, not just a page load.
  storage          TEXT        NOT NULL DEFAULT 'temporary'
                     CHECK (storage IN ('temporary', 'permanent')),
  storage_note     TEXT,

  error            TEXT,
  stopped_watching_at TIMESTAMPTZ,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_video_generations_user
  ON video_generations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_generations_profile
  ON video_generations (intel_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_generations_project
  ON video_generations (project_id, created_at DESC);
-- Finding renders that are still in flight, from any device.
CREATE INDEX IF NOT EXISTS idx_video_generations_inflight
  ON video_generations (user_id, status) WHERE status IN ('pending', 'processing');

-- ── updated_at ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_video_generations()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_video_generations_touch ON video_generations;
CREATE TRIGGER trg_video_generations_touch
  BEFORE UPDATE ON video_generations
  FOR EACH ROW EXECUTE FUNCTION touch_video_generations();

-- ── Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE video_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "video_generations_owner_all" ON video_generations;
CREATE POLICY "video_generations_owner_all" ON video_generations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- A teammate on a shared intelligence profile can see the videos generated
-- under it — the same sharing rule the rest of the profile-scoped data follows.
DROP POLICY IF EXISTS "video_generations_member_read" ON video_generations;
CREATE POLICY "video_generations_member_read" ON video_generations
  FOR SELECT USING (
    intel_profile_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM intelligence_profiles p
        WHERE p.id = video_generations.intel_profile_id AND p.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM intelligence_profile_members m
        WHERE m.profile_id = video_generations.intel_profile_id AND m.user_id = auth.uid()
      )
    )
  );
