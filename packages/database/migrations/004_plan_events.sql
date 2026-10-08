-- Up Migration

-- The agent's own one-sentence statement of intent is recorded before its steps.
alter table execution_events drop constraint execution_events_kind_check;
alter table execution_events add constraint execution_events_kind_check
  check (kind in ('progress', 'tool_call', 'check', 'permission', 'error', 'edit', 'artifact', 'plan'));

-- Down Migration
alter table execution_events drop constraint execution_events_kind_check;
alter table execution_events add constraint execution_events_kind_check
  check (kind in ('progress', 'tool_call', 'check', 'permission', 'error', 'edit', 'artifact'));
