-- Audema support tickets — the "Help & Support" link that has never gone
-- anywhere.
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: database/supabase-schema.sql (profiles) already run.
--
-- Two tables rather than one because a ticket and its conversation have
-- different lifetimes: the ticket carries status and priority that change
-- over time, the replies are append-only and must never be edited after the
-- fact — a support thread that can be rewritten is not a record of anything.

CREATE TABLE IF NOT EXISTS support_tickets (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject       TEXT        NOT NULL,
  category      TEXT        NOT NULL DEFAULT 'question',
  status        TEXT        NOT NULL DEFAULT 'open',
  priority      TEXT        NOT NULL DEFAULT 'normal',
  -- Where the customer was when they hit the problem. Filled in by the form,
  -- not typed by the customer, because "it broke on the page I was on" is the
  -- single most useful thing a ticket can carry and the one people forget.
  page_url      TEXT,
  -- Plan at the time of writing. Stored on the ticket rather than joined from
  -- profiles, because a ticket about a plan limit read differently after the
  -- customer upgrades, and the join would silently rewrite the history.
  plan_at_open  TEXT,
  last_reply_at TIMESTAMPTZ DEFAULT NOW(),
  last_reply_by TEXT        NOT NULL DEFAULT 'customer',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT support_tickets_status_valid
    CHECK (status IN ('open','pending','resolved','closed')),
  CONSTRAINT support_tickets_priority_valid
    CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT support_tickets_category_valid
    CHECK (category IN ('question','bug','billing','feature','account','other')),
  CONSTRAINT support_tickets_last_reply_by_valid
    CHECK (last_reply_by IN ('customer','support')),
  CONSTRAINT support_tickets_subject_nonempty
    CHECK (length(btrim(subject)) > 0)
);

CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  ticket_id   UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Denormalised so the thread still reads correctly after an author's account
  -- is deleted and author_id goes null.
  author_role TEXT        NOT NULL DEFAULT 'customer',
  body        TEXT        NOT NULL,
  -- A note the customer never sees. Kept in the same table so the ordering of
  -- the conversation and the notes about it cannot drift apart.
  internal    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT support_replies_role_valid CHECK (author_role IN ('customer','support')),
  CONSTRAINT support_replies_body_nonempty CHECK (length(btrim(body)) > 0),
  -- Only support can write an internal note. A customer-authored hidden
  -- message would be a message nobody ever reads.
  CONSTRAINT support_replies_internal_is_support
    CHECK (internal = FALSE OR author_role = 'support')
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user    ON support_tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status  ON support_tickets (status, last_reply_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_replies_ticket  ON support_ticket_replies (ticket_id, created_at);

-- ── updated_at ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_support_ticket()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_support_tickets_touch ON support_tickets;
CREATE TRIGGER trg_support_tickets_touch
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION touch_support_ticket();

-- ── Keep the queue ordered by real activity ────────────────────────────────
-- The admin queue sorts by "who is waiting on us longest", which is only
-- meaningful if last_reply_at moves when a reply is actually written. Doing it
-- in a trigger rather than in the API means it cannot be forgotten by a caller.
--
-- Any customer reply puts the ticket back to 'open', whatever it was before.
-- 'pending' means "waiting on the customer", and the moment they write back
-- that stops being true: leaving it pending would drop the ticket out of the
-- Open queue while the customer sits waiting for an answer. Resolved and
-- closed reopen for the same reason — from their side the problem is still
-- happening, and a ticket nobody is looking at is not a resolved one.
CREATE OR REPLACE FUNCTION bump_support_ticket_on_reply()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.internal THEN RETURN NEW; END IF;   -- notes are not activity

  UPDATE support_tickets
     SET last_reply_at = NEW.created_at,
         last_reply_by = NEW.author_role,
         status = CASE
           WHEN NEW.author_role = 'customer' THEN 'open'
           WHEN NEW.author_role = 'support' AND status = 'open' THEN 'pending'
           ELSE status
         END
   WHERE id = NEW.ticket_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_support_reply_bump ON support_ticket_replies;
CREATE TRIGGER trg_support_reply_bump
  AFTER INSERT ON support_ticket_replies
  FOR EACH ROW EXECUTE FUNCTION bump_support_ticket_on_reply();

-- ── Row-Level Security ─────────────────────────────────────────────────────
-- All writes go through api/support-tickets.js with the service-role key,
-- which does its own permission checks. These policies exist so that a direct
-- browser read (or a future client-side read) cannot see another customer's
-- tickets even if the endpoint were bypassed entirely.
ALTER TABLE support_tickets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_self_read" ON support_tickets;
CREATE POLICY "support_tickets_self_read" ON support_tickets
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "support_tickets_self_insert" ON support_tickets;
CREATE POLICY "support_tickets_self_insert" ON support_tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "support_tickets_admin_all" ON support_tickets;
CREATE POLICY "support_tickets_admin_all" ON support_tickets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin'))
  );

-- Deliberately no self-UPDATE policy on support_tickets: a customer who could
-- update their own row could set priority = 'urgent' on everything, and the
-- queue order would stop meaning anything. Status is support's to set.

-- Replies: a customer sees their own thread, minus the internal notes.
DROP POLICY IF EXISTS "support_replies_self_read" ON support_ticket_replies;
CREATE POLICY "support_replies_self_read" ON support_ticket_replies
  FOR SELECT USING (
    internal = FALSE
    AND EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "support_replies_self_insert" ON support_ticket_replies;
CREATE POLICY "support_replies_self_insert" ON support_ticket_replies
  FOR INSERT WITH CHECK (
    internal = FALSE
    AND author_role = 'customer'
    AND auth.uid() = author_id
    AND EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "support_replies_admin_all" ON support_ticket_replies;
CREATE POLICY "support_replies_admin_all" ON support_ticket_replies
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin'))
  );

-- No UPDATE or DELETE policy for customers on replies either: a support thread
-- where either side can edit what was already said is not a record.

-- DONE! Support tickets can now be raised, answered and tracked.
