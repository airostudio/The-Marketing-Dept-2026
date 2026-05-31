-- ═══════════════════════════════════════════════════════════════════════════
-- Aduma Marketing Platform — Supabase Schema
-- Run this in the Supabase SQL Editor to create all required tables.
-- RLS policies ensure each user can only access their own rows.
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable UUID extension (usually already on)
create extension if not exists "uuid-ossp";

-- ─── profiles ────────────────────────────────────────────────────────────────
-- Table already exists — only add columns that may be missing.
-- Your existing rows and data are untouched.
alter table if exists profiles add column if not exists firstname   text;
alter table if exists profiles add column if not exists lastname    text;
alter table if exists profiles add column if not exists plan        text default 'free';
alter table if exists profiles add column if not exists created_at  timestamptz default now();
alter table if exists profiles add column if not exists updated_at  timestamptz default now();

-- Enable RLS if not already on (safe to run repeatedly)
alter table if exists profiles enable row level security;

-- Add policy only if it doesn't exist
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'profiles' and policyname = 'Users manage own profile'
  ) then
    execute 'create policy "Users manage own profile" on profiles for all using (auth.uid() = id)';
  end if;
end $$;

-- Auto-create/update profile on signup — only writes columns that exist
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

-- ─── projects ─────────────────────────────────────────────────────────────────
create table if not exists projects (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users on delete cascade,
  name          text not null,
  website_url   text,
  keywords      jsonb default '[]',
  competitors   jsonb default '[]',
  settings      jsonb default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table projects enable row level security;
create policy "Users manage own projects"
  on projects for all using (auth.uid() = user_id);
create index if not exists projects_user_id_idx on projects(user_id);

-- ─── audits ───────────────────────────────────────────────────────────────────
create table if not exists audits (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references projects on delete cascade,
  score       int,
  status      text default 'pending',
  data        jsonb default '{}',
  created_at  timestamptz default now()
);
alter table audits enable row level security;
create policy "Users manage own audits"
  on audits for all using (
    exists (select 1 from projects where projects.id = audits.project_id and projects.user_id = auth.uid())
  );
create index if not exists audits_project_id_idx on audits(project_id);

-- ─── audit_issues ─────────────────────────────────────────────────────────────
create table if not exists audit_issues (
  id          uuid primary key default uuid_generate_v4(),
  audit_id    uuid not null references audits on delete cascade,
  type        text,
  severity    text,
  title       text,
  description text,
  url         text,
  data        jsonb default '{}',
  created_at  timestamptz default now()
);
alter table audit_issues enable row level security;
create policy "Users manage own audit issues"
  on audit_issues for all using (
    exists (
      select 1 from audits
      join projects on projects.id = audits.project_id
      where audits.id = audit_issues.audit_id and projects.user_id = auth.uid()
    )
  );

-- ─── keywords ─────────────────────────────────────────────────────────────────
-- Table already exists (empty) — add any missing columns and wire up RLS.
create table if not exists keywords (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid references projects on delete cascade,
  keyword     text not null,
  volume      int,
  difficulty  int,
  position    int,
  data        jsonb default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table if exists keywords add column if not exists project_id  uuid references projects on delete cascade;
alter table if exists keywords add column if not exists volume      int;
alter table if exists keywords add column if not exists difficulty  int;
alter table if exists keywords add column if not exists position    int;
alter table if exists keywords add column if not exists data        jsonb default '{}';
alter table if exists keywords add column if not exists created_at  timestamptz default now();
alter table if exists keywords add column if not exists updated_at  timestamptz default now();
alter table if exists keywords enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'keywords' and policyname = 'Users manage own keywords'
  ) then
    execute $p$create policy "Users manage own keywords" on keywords for all using (
      exists (select 1 from projects where projects.id = keywords.project_id and projects.user_id = auth.uid())
    )$p$;
  end if;
end $$;
create index if not exists keywords_project_id_idx on keywords(project_id);

-- ─── keyword_rankings ─────────────────────────────────────────────────────────
create table if not exists keyword_rankings (
  id           uuid primary key default uuid_generate_v4(),
  keyword_id   uuid not null references keywords on delete cascade,
  position     int,
  url          text,
  recorded_at  timestamptz default now()
);
alter table keyword_rankings enable row level security;
create policy "Users manage own keyword rankings"
  on keyword_rankings for all using (
    exists (
      select 1 from keywords
      join projects on projects.id = keywords.project_id
      where keywords.id = keyword_rankings.keyword_id and projects.user_id = auth.uid()
    )
  );

-- ─── competitors ──────────────────────────────────────────────────────────────
create table if not exists competitors (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references projects on delete cascade,
  domain      text not null,
  name        text,
  data        jsonb default '{}',
  created_at  timestamptz default now()
);
alter table competitors enable row level security;
create policy "Users manage own competitors"
  on competitors for all using (
    exists (select 1 from projects where projects.id = competitors.project_id and projects.user_id = auth.uid())
  );

-- ─── backlinks ────────────────────────────────────────────────────────────────
create table if not exists backlinks (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references projects on delete cascade,
  source_url   text not null,
  target_url   text not null,
  anchor_text  text,
  domain_rating int,
  discovered_at timestamptz default now(),
  unique (source_url, target_url)
);
alter table backlinks enable row level security;
create policy "Users manage own backlinks"
  on backlinks for all using (
    exists (select 1 from projects where projects.id = backlinks.project_id and projects.user_id = auth.uid())
  );

-- ─── alerts ───────────────────────────────────────────────────────────────────
create table if not exists alerts (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references projects on delete cascade,
  type        text,
  severity    text default 'info',
  title       text,
  message     text,
  read        boolean default false,
  read_at     timestamptz,
  created_at  timestamptz default now()
);
alter table alerts enable row level security;
create policy "Users manage own alerts"
  on alerts for all using (
    exists (select 1 from projects where projects.id = alerts.project_id and projects.user_id = auth.uid())
  );

-- ─── user_settings ────────────────────────────────────────────────────────────
create table if not exists user_settings (
  user_id     uuid primary key references auth.users on delete cascade,
  settings    jsonb default '{}',
  updated_at  timestamptz default now()
);
alter table user_settings enable row level security;
create policy "Users manage own settings"
  on user_settings for all using (auth.uid() = user_id);

-- ─── customers ────────────────────────────────────────────────────────────────
create table if not exists customers (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text,
  email       text,
  company     text,
  status      text default 'active',
  data        jsonb default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table customers enable row level security;
create policy "Users manage own customers"
  on customers for all using (auth.uid() = user_id);
create index if not exists customers_user_id_idx on customers(user_id);

-- ─── health_scores ────────────────────────────────────────────────────────────
create table if not exists health_scores (
  id           uuid primary key default uuid_generate_v4(),
  customer_id  uuid not null references customers on delete cascade,
  score        int,
  data         jsonb default '{}',
  created_at   timestamptz default now()
);
alter table health_scores enable row level security;
create policy "Users manage own health scores"
  on health_scores for all using (
    exists (select 1 from customers where customers.id = health_scores.customer_id and customers.user_id = auth.uid())
  );

-- ─── campaigns ────────────────────────────────────────────────────────────────
create table if not exists campaigns (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text,
  status      text default 'draft',
  type        text,
  data        jsonb default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table campaigns enable row level security;
create policy "Users manage own campaigns"
  on campaigns for all using (auth.uid() = user_id);

-- ─── lifecycle_events ─────────────────────────────────────────────────────────
create table if not exists lifecycle_events (
  id           uuid primary key default uuid_generate_v4(),
  customer_id  uuid not null references customers on delete cascade,
  from_stage   text,
  to_stage     text,
  metadata     jsonb default '{}',
  created_at   timestamptz default now()
);
alter table lifecycle_events enable row level security;
create policy "Users manage own lifecycle events"
  on lifecycle_events for all using (
    exists (select 1 from customers where customers.id = lifecycle_events.customer_id and customers.user_id = auth.uid())
  );

-- ─── deals ────────────────────────────────────────────────────────────────────
create table if not exists deals (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text,
  amount      numeric,
  stage       text default 'prospecting',
  data        jsonb default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table deals enable row level security;
create policy "Users manage own deals"
  on deals for all using (auth.uid() = user_id);

-- ─── icp_profiles ─────────────────────────────────────────────────────────────
create table if not exists icp_profiles (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text,
  data        jsonb default '{}',
  created_at  timestamptz default now()
);
alter table icp_profiles enable row level security;
create policy "Users manage own ICP profiles"
  on icp_profiles for all using (auth.uid() = user_id);

-- ─── integrations ─────────────────────────────────────────────────────────────
create table if not exists integrations (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users on delete cascade,
  provider    text not null,
  credentials jsonb default '{}',
  updated_at  timestamptz default now(),
  unique (user_id, provider)
);
alter table integrations enable row level security;
create policy "Users manage own integrations"
  on integrations for all using (auth.uid() = user_id);

-- ─── brand_data ───────────────────────────────────────────────────────────────
-- Persists Business Brain / Intelligence Engine data server-side
create table if not exists brand_data (
  user_id     uuid primary key references auth.users on delete cascade,
  data        jsonb not null default '{}',
  updated_at  timestamptz default now()
);
alter table brand_data enable row level security;
create policy "Users manage own brand data"
  on brand_data for all using (auth.uid() = user_id);

-- ─── agent_history ────────────────────────────────────────────────────────────
-- Persists AI agent output history across devices
create table if not exists agent_history (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users on delete cascade,
  agent_id    text not null,
  title       text,
  content     text,
  data        jsonb default '{}',
  created_at  timestamptz default now()
);
alter table agent_history enable row level security;
create policy "Users manage own agent history"
  on agent_history for all using (auth.uid() = user_id);
create index if not exists agent_history_user_agent_idx on agent_history(user_id, agent_id);
