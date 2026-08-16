-- Audema Audience — consent tracking (additive to supabase-audience.sql)
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Requires: supabase-audience.sql already run.
--
-- Fixes a gap from the 2026 Agent Audit: contacts had a `source` field
-- ('manual'/'paste'/'csv_import') but no record of the actual lawful basis
-- for holding someone's email — a "how did we get permission to email this
-- person" field, not just "how did the row get typed in." This is what
-- Beeker's import flow now asks for and records per contact.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ;

COMMENT ON COLUMN contacts.consent_source IS
  'Lawful basis / how this contact agreed to receive marketing email — e.g. "Website signup form", "Event/conference opt-in", "Existing customer", "Imported from CRM (consent verified there)". Distinct from `source`, which just tracks how the row entered this system (manual/paste/csv_import).';
COMMENT ON COLUMN contacts.consent_timestamp IS
  'When consent was given, if known. Defaults to import time when the importer does not supply an earlier date.';
