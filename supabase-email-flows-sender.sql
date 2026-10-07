-- ═══════════════════════════════════════════════════════════════════════════
-- Who an automation flow is sent as
-- ═══════════════════════════════════════════════════════════════════════════
-- A flow's steps can use {{senderName}}, {{senderFirstName}}, {{senderTitle}},
-- {{senderEmail}}, {{senderPhone}} and {{senderCompany}}. The values are a
-- snapshot of the Business Brain contact chosen when the flow was saved
-- (the cron has no browser to read the Brain from). Whitelisted keys only —
-- see api/_lib/flow-merge.js.
--
-- Safe to run more than once. Run after supabase-email-engine.sql.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE email_flows ADD COLUMN IF NOT EXISTS sender_fields JSONB;
