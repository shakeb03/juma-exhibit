-- Up Migration

-- One saved canvas per agency session. Nodes and edges are JSON; revision guards concurrent saves.
create table canvases (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null unique references agencies (id) on delete cascade,
  revision integer not null default 1,
  nodes jsonb not null default '[]',
  edges jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- Immutable snapshots, so every chat turn can point at the exact graph it ran against.
create table canvas_revisions (
  canvas_id uuid not null references canvases (id) on delete cascade,
  revision integer not null,
  nodes jsonb not null,
  edges jsonb not null,
  created_at timestamptz not null default now(),
  primary key (canvas_id, revision)
);

-- A conversation belongs to one client, or to one chat node on the canvas.
create table conversations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  kind text not null check (kind in ('client', 'canvas_chat')),
  client_id uuid references clients (id) on delete cascade,
  canvas_id uuid references canvases (id) on delete cascade,
  chat_node_id text,
  created_at timestamptz not null default now(),
  check (
    (kind = 'client' and client_id is not null and canvas_id is null and chat_node_id is null)
    or (kind = 'canvas_chat' and client_id is null and canvas_id is not null and chat_node_id is not null)
  )
);
create unique index conversations_client_idx on conversations (client_id) where kind = 'client';
create unique index conversations_chat_node_idx on conversations (canvas_id, chat_node_id) where kind = 'canvas_chat';

-- A turn is one user request and its response.
create table turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  agency_id uuid not null references agencies (id) on delete cascade,
  seq integer not null,
  idempotency_key text not null,
  user_message text not null,
  attachment_source_ids uuid[] not null default '{}',
  -- Optional: the artifact version the user was looking at when they asked.
  referenced_version_id uuid,
  canvas_revision integer,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  reply_kind text check (reply_kind in ('answer', 'clarification', 'failure')),
  reply_message text,
  reply_data jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (conversation_id, seq),
  unique (conversation_id, idempotency_key)
);

-- Executions double as the durable job queue: a worker leases one by locking its row.
create table executions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies (id) on delete cascade,
  kind text not null check (kind in ('turn', 'comment_edit', 'export')),
  turn_id uuid references turns (id) on delete cascade,
  comment_id uuid,
  export_id uuid,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting_to_retry', 'succeeded', 'failed', 'cancelled')),
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  cancel_requested boolean not null default false,
  routing_version text,
  routing_snapshot jsonb,
  backend_commit text,
  -- What the run was allowed to see: permission flags, source versions, attachments.
  input_snapshot jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index executions_queue_idx on executions (available_at) where status in ('queued', 'waiting_to_retry');
create index executions_lease_idx on executions (lease_expires_at) where status = 'running';
create index executions_turn_idx on executions (turn_id);

-- Ordered progress, tool calls, checks, and errors. The bigserial id is the polling cursor.
create table execution_events (
  id bigserial primary key,
  execution_id uuid not null references executions (id) on delete cascade,
  kind text not null check (kind in ('progress', 'tool_call', 'check', 'permission', 'error', 'edit', 'artifact')),
  name text not null,
  -- Redacted and size-bounded before storage.
  payload jsonb,
  payload_truncated boolean not null default false,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index execution_events_cursor_idx on execution_events (execution_id, id);

create table model_calls (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references executions (id) on delete cascade,
  task text not null,
  attempt integer not null default 1,
  requested_model text not null,
  actual_model text,
  provider text,
  -- Messages sent and content returned, never private reasoning. Redacted and size-bounded.
  request_payload jsonb,
  response_payload jsonb,
  payload_truncated boolean not null default false,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  cost_usd numeric(12, 6),
  cost_estimated boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index model_calls_execution_idx on model_calls (execution_id, created_at);

-- Down Migration
drop table model_calls;
drop table execution_events;
drop table executions;
drop table turns;
drop table conversations;
drop table canvas_revisions;
drop table canvases;
