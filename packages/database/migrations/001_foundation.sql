-- Up Migration

-- A demo agency is one visitor's isolated workspace. Everything below hangs off it,
-- so deleting an expired agency removes all of its data.
create table agencies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  token_budget bigint not null default 0,
  tokens_reserved bigint not null default 0,
  tokens_spent bigint not null default 0
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_agency_idx on sessions (agency_id);

create table clients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  slug text not null,
  name text not null,
  category text not null,
  brand_voice text not null default '',
  audience text not null default '',
  goals text not null default '',
  constraints text not null default '',
  standing_instructions text not null default '',
  -- Two separate approvals for cross-client intelligence. New clients start restricted.
  share_performance boolean not null default false,
  share_creative boolean not null default false,
  -- Incremented when sharing changes so results built on older permissions can be invalidated.
  permission_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (agency_id, slug)
);

-- Original bytes live here. agency_id is null only for shared immutable fixture bytes.
create table file_blobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies (id) on delete cascade,
  fixture_key text,
  mime_type text not null,
  size_bytes integer not null check (size_bytes >= 0),
  sha256 text not null,
  data bytea not null,
  created_at timestamptz not null default now(),
  check (agency_id is not null or fixture_key is not null)
);
create unique index file_blobs_fixture_key_idx on file_blobs (fixture_key) where fixture_key is not null;
create index file_blobs_agency_sha_idx on file_blobs (agency_id, sha256);

-- Sources never select the blob column; use the blob_id to fetch bytes separately.
create table sources (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  -- Null for canvas-level sources such as new-client briefs and references.
  client_id uuid references clients (id) on delete cascade,
  kind text not null check (kind in (
    'brand_context', 'brief', 'campaign_data', 'creative_references',
    'creative_image', 'previous_work', 'new_client_brief', 'reference', 'attachment'
  )),
  name text not null,
  blob_id uuid not null references file_blobs (id),
  mime_type text not null,
  size_bytes integer not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error text,
  extracted_text text,
  version integer not null default 1,
  fixture_path text,
  created_at timestamptz not null default now()
);
create index sources_agency_client_idx on sources (agency_id, client_id);

create table campaign_rows (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  source_id uuid not null references sources (id) on delete cascade,
  campaign_id text not null,
  campaign_name text not null,
  channel text not null,
  period text not null,
  start_date date not null,
  end_date date not null,
  currency char(3) not null,
  -- Null means the value was missing in the file, which is different from zero.
  spend numeric(14, 2),
  impressions bigint,
  clicks bigint,
  conversions bigint,
  revenue numeric(14, 2),
  attribution_window text not null,
  creative_ref_id text,
  unique (source_id, campaign_id)
);
create index campaign_rows_client_idx on campaign_rows (client_id, channel, end_date);

create table creative_references (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  source_id uuid not null references sources (id) on delete cascade,
  ref_id text not null,
  campaign_id text,
  title text not null,
  description text not null,
  visual_style text not null,
  storytelling_approach text not null,
  format text not null,
  asset_note text not null,
  -- Set only when an actual image file exists; text-only references leave this null.
  image_blob_id uuid references file_blobs (id),
  unique (source_id, ref_id)
);
create index creative_references_client_idx on creative_references (client_id);

-- Down Migration
drop table creative_references;
drop table campaign_rows;
drop table sources;
drop table file_blobs;
drop table clients;
drop table sessions;
drop table agencies;
