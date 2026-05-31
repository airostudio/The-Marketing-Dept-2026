-- ═══════════════════════════════════════════════════════════════════════════
-- Aduma Marketing Platform — Supabase Schema
--
-- Safe to run on an existing Supabase project:
--   • Uses CREATE TABLE IF NOT EXISTS everywhere
--   • Uses ALTER TABLE ADD COLUMN IF NOT EXISTS for existing tables
--   • Wraps every policy in a DO block — skips if already exists,
--     and only creates the policy when the required column is present
--   • Never drops or truncates anything
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";

-- ─── helper: create a policy only when safe ───────────────────────────────────
-- Usage: call _safe_policy('tablename', 'policy name', 'policy SQL');
create or replace function _safe_policy(tbl text, pol text, sql text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from pg_policies where tablename = tbl and policyname = pol
  ) then
    execute sql;
  end if;
exception when others then
  raise notice 'Skipped policy "%" on %: %', pol, tbl, sqlerrm;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- PROFILES  (table already exists — patch only)
-- ════════════════════════════════════════════════════════════════════════════
alter table if exists profiles add column if not exists firstname  text;
alter table if exists profiles add column if not exists lastname   text;
alter table if exists profiles add column if not exists plan       text default 'free';
alter table if exists profiles add column if not exists updated_at timestamptz default now();

alter table if exists profiles enable row level security;

select _safe_policy('profiles', 'Users manage own profile',
  'create policy "Users manage own profile" on profiles for all using (auth.uid() = id)');

-- Trigger: auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, firstname, lastname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'firstname', new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'lastname',  new.raw_user_meta_data->>'last_name',  '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ════════════════════════════════════════════════════════════════════════════
-- PROJECTS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists projects (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users on delete cascade,
  name        text,
  website_url text,
  keywords    jsonb default '[]',
  competitors jsonb default '[]',
  settings    jsonb default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
-- Patch existing table: add user_id if the column is missing
alter table if exists projects add column if not exists user_id     uuid references auth.users on delete cascade;
alter table if exists projects add column if not exists website_url text;
alter table if exists projects add column if not exists keywords    jsonb default '[]';
alter table if exists projects add column if not exists competitors jsonb default '[]';
alter table if exists projects add column if not exists settings    jsonb default '{}';
alter table if exists projects add column if not exists updated_at  timestamptz default now();

alter table if exists projects enable row level security;
create index if not exists projects_user_id_idx on projects(user_id);

select _safe_policy('projects', 'Users manage own projects',
  'create policy "Users manage own projects" on projects for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- KEYWORDS  (table already exists — patch only)
-- Add user_id directly so the policy doesn't depend on the projects join
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists keywords (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  project_id uuid references projects on delete cascade,
  keyword    text,
  volume     int,
  difficulty int,
  position   int,
  data       jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table if exists keywords add column if not exists user_id    uuid references auth.users on delete cascade;
alter table if exists keywords add column if not exists project_id uuid references projects on delete cascade;
alter table if exists keywords add column if not exists volume     int;
alter table if exists keywords add column if not exists difficulty int;
alter table if exists keywords add column if not exists position   int;
alter table if exists keywords add column if not exists data       jsonb default '{}';
alter table if exists keywords add column if not exists updated_at timestamptz default now();

alter table if exists keywords enable row level security;
create index if not exists keywords_user_id_idx    on keywords(user_id);
create index if not exists keywords_project_id_idx on keywords(project_id);

select _safe_policy('keywords', 'Users manage own keywords',
  'create policy "Users manage own keywords" on keywords for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- KEYWORD RANKINGS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists keyword_rankings (
  id          uuid primary key default uuid_generate_v4(),
  keyword_id  uuid references keywords on delete cascade,
  user_id     uuid references auth.users on delete cascade,
  position    int,
  url         text,
  recorded_at timestamptz default now()
);
alter table if exists keyword_rankings add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists keyword_rankings enable row level security;

select _safe_policy('keyword_rankings', 'Users manage own keyword rankings',
  'create policy "Users manage own keyword rankings" on keyword_rankings for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- AUDITS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists audits (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  project_id uuid references projects on delete cascade,
  score      int,
  status     text default 'pending',
  data       jsonb default '{}',
  created_at timestamptz default now()
);
alter table if exists audits add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists audits enable row level security;
create index if not exists audits_user_id_idx on audits(user_id);

select _safe_policy('audits', 'Users manage own audits',
  'create policy "Users manage own audits" on audits for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- AUDIT ISSUES
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists audit_issues (
  id          uuid primary key default uuid_generate_v4(),
  audit_id    uuid references audits on delete cascade,
  user_id     uuid references auth.users on delete cascade,
  type        text,
  severity    text,
  title       text,
  description text,
  url         text,
  data        jsonb default '{}',
  created_at  timestamptz default now()
);
alter table if exists audit_issues add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists audit_issues enable row level security;

select _safe_policy('audit_issues', 'Users manage own audit issues',
  'create policy "Users manage own audit issues" on audit_issues for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- COMPETITORS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists competitors (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  project_id uuid references projects on delete cascade,
  domain     text,
  name       text,
  data       jsonb default '{}',
  created_at timestamptz default now()
);
alter table if exists competitors add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists competitors enable row level security;

select _safe_policy('competitors', 'Users manage own competitors',
  'create policy "Users manage own competitors" on competitors for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- BACKLINKS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists backlinks (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users on delete cascade,
  project_id    uuid references projects on delete cascade,
  source_url    text,
  target_url    text,
  anchor_text   text,
  domain_rating int,
  discovered_at timestamptz default now()
);
alter table if exists backlinks add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists backlinks enable row level security;

select _safe_policy('backlinks', 'Users manage own backlinks',
  'create policy "Users manage own backlinks" on backlinks for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- ALERTS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists alerts (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  project_id uuid references projects on delete cascade,
  type       text,
  severity   text default 'info',
  title      text,
  message    text,
  read       boolean default false,
  read_at    timestamptz,
  created_at timestamptz default now()
);
alter table if exists alerts add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists alerts enable row level security;

select _safe_policy('alerts', 'Users manage own alerts',
  'create policy "Users manage own alerts" on alerts for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- USER SETTINGS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists user_settings (
  user_id    uuid primary key references auth.users on delete cascade,
  settings   jsonb default '{}',
  updated_at timestamptz default now()
);
alter table if exists user_settings enable row level security;

select _safe_policy('user_settings', 'Users manage own settings',
  'create policy "Users manage own settings" on user_settings for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- CUSTOMERS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists customers (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  name       text,
  email      text,
  company    text,
  status     text default 'active',
  data       jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table if exists customers add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists customers enable row level security;
create index if not exists customers_user_id_idx on customers(user_id);

select _safe_policy('customers', 'Users manage own customers',
  'create policy "Users manage own customers" on customers for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- HEALTH SCORES
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists health_scores (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users on delete cascade,
  customer_id uuid references customers on delete cascade,
  score       int,
  data        jsonb default '{}',
  created_at  timestamptz default now()
);
alter table if exists health_scores add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists health_scores enable row level security;

select _safe_policy('health_scores', 'Users manage own health scores',
  'create policy "Users manage own health scores" on health_scores for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- CAMPAIGNS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists campaigns (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  name       text,
  status     text default 'draft',
  type       text,
  data       jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table if exists campaigns add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists campaigns enable row level security;

select _safe_policy('campaigns', 'Users manage own campaigns',
  'create policy "Users manage own campaigns" on campaigns for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- LIFECYCLE EVENTS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists lifecycle_events (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users on delete cascade,
  customer_id uuid references customers on delete cascade,
  from_stage  text,
  to_stage    text,
  metadata    jsonb default '{}',
  created_at  timestamptz default now()
);
alter table if exists lifecycle_events add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists lifecycle_events enable row level security;

select _safe_policy('lifecycle_events', 'Users manage own lifecycle events',
  'create policy "Users manage own lifecycle events" on lifecycle_events for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- DEALS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists deals (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  name       text,
  amount     numeric,
  stage      text default 'prospecting',
  data       jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table if exists deals add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists deals enable row level security;

select _safe_policy('deals', 'Users manage own deals',
  'create policy "Users manage own deals" on deals for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- ICP PROFILES
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists icp_profiles (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  name       text,
  data       jsonb default '{}',
  created_at timestamptz default now()
);
alter table if exists icp_profiles add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists icp_profiles enable row level security;

select _safe_policy('icp_profiles', 'Users manage own ICP profiles',
  'create policy "Users manage own ICP profiles" on icp_profiles for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- INTEGRATIONS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists integrations (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  provider   text,
  credentials jsonb default '{}',
  updated_at timestamptz default now()
);
alter table if exists integrations add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists integrations enable row level security;

-- Unique constraint on user_id + provider (safe to add if missing)
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'integrations_user_id_provider_key'
  ) then
    alter table integrations add constraint integrations_user_id_provider_key unique (user_id, provider);
  end if;
exception when others then
  raise notice 'integrations unique constraint already exists, skipping';
end $$;

select _safe_policy('integrations', 'Users manage own integrations',
  'create policy "Users manage own integrations" on integrations for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- BRAND DATA  (Business Brain / Intelligence Engine)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists brand_data (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table if exists brand_data enable row level security;

select _safe_policy('brand_data', 'Users manage own brand data',
  'create policy "Users manage own brand data" on brand_data for all using (auth.uid() = user_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- AGENT HISTORY
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists agent_history (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users on delete cascade,
  agent_id   text,
  title      text,
  content    text,
  data       jsonb default '{}',
  created_at timestamptz default now()
);
alter table if exists agent_history add column if not exists user_id uuid references auth.users on delete cascade;
alter table if exists agent_history enable row level security;
create index if not exists agent_history_user_agent_idx on agent_history(user_id, agent_id);

select _safe_policy('agent_history', 'Users manage own agent history',
  'create policy "Users manage own agent history" on agent_history for all using (auth.uid() = user_id)');

-- ─── cleanup helper function ──────────────────────────────────────────────────
drop function if exists _safe_policy(text, text, text);
