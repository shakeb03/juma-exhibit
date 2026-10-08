-- Up Migration

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  kind text not null check (kind in (
    'performance_report', 'campaign_brief', 'client_summary', 'campaign_concepts', 'experiment_plan'
  )),
  title text not null,
  current_version_id uuid,
  created_at timestamptz not null default now()
);
create index artifacts_conversation_idx on artifacts (conversation_id);

-- Every change is a new version. Version numbers only increase, even when revising an older version.
create table artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifacts (id) on delete cascade,
  version integer not null,
  -- Ordered blocks with stable IDs, validated by the shared block schema.
  blocks jsonb not null,
  -- Evidence links: metric records, source rows, and the checks that were run.
  evidence jsonb not null default '{}',
  checks jsonb not null default '{}',
  cause_kind text not null check (cause_kind in ('turn', 'comment', 'manual')),
  cause_turn_id uuid references turns (id) on delete set null,
  cause_comment_id uuid,
  base_version_id uuid references artifact_versions (id),
  -- Fingerprints let changed sources or permissions invalidate cross-client results.
  source_fingerprint text,
  permission_fingerprint text,
  created_at timestamptz not null default now(),
  unique (artifact_id, version)
);

alter table artifacts
  add constraint artifacts_current_version_fk
  foreign key (current_version_id) references artifact_versions (id);

alter table turns
  add constraint turns_referenced_version_fk
  foreign key (referenced_version_id) references artifact_versions (id) on delete set null;

create table comments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  artifact_id uuid not null references artifacts (id) on delete cascade,
  version_id uuid not null references artifact_versions (id) on delete cascade,
  block_id text not null,
  selection jsonb,
  body text not null,
  author_session_id uuid references sessions (id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'proposed', 'accepted', 'rejected', 'stale', 'failed')),
  proposal jsonb,
  resulting_version_id uuid references artifact_versions (id),
  created_at timestamptz not null default now()
);
create index comments_artifact_idx on comments (artifact_id, created_at);

alter table executions
  add constraint executions_comment_fk
  foreign key (comment_id) references comments (id) on delete cascade;

alter table artifact_versions
  add constraint artifact_versions_comment_fk
  foreign key (cause_comment_id) references comments (id) on delete set null;

-- Approval applies to exactly one version.
create table approvals (
  id uuid primary key default gen_random_uuid(),
  artifact_version_id uuid not null unique references artifact_versions (id) on delete cascade,
  session_id uuid references sessions (id) on delete set null,
  approved_at timestamptz not null default now()
);

create table exports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  artifact_version_id uuid not null references artifact_versions (id) on delete cascade,
  label text not null check (label in ('Draft', 'Approved')),
  status text not null default 'queued' check (status in ('queued', 'succeeded', 'failed')),
  blob_id uuid references file_blobs (id),
  checksum text,
  error text,
  created_at timestamptz not null default now(),
  -- A retry of the same version and label reuses this row instead of creating a duplicate file.
  unique (artifact_version_id, label),
  -- A succeeded export must have its file.
  check (status <> 'succeeded' or (blob_id is not null and checksum is not null))
);

alter table executions
  add constraint executions_export_fk
  foreign key (export_id) references exports (id) on delete cascade;

-- Down Migration
alter table executions drop constraint executions_export_fk;
alter table executions drop constraint executions_comment_fk;
drop table exports;
drop table approvals;
alter table artifact_versions drop constraint artifact_versions_comment_fk;
alter table turns drop constraint turns_referenced_version_fk;
alter table artifacts drop constraint artifacts_current_version_fk;
drop table comments;
drop table artifact_versions;
drop table artifacts;
