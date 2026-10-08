-- Up Migration

-- Cross-client analysis can produce a category insight, in addition to concepts and experiment plans.
alter table artifacts drop constraint artifacts_kind_check;
alter table artifacts add constraint artifacts_kind_check check (kind in (
  'performance_report', 'campaign_brief', 'client_summary', 'campaign_concepts', 'experiment_plan', 'category_insight'
));

-- Down Migration
alter table artifacts drop constraint artifacts_kind_check;
alter table artifacts add constraint artifacts_kind_check check (kind in (
  'performance_report', 'campaign_brief', 'client_summary', 'campaign_concepts', 'experiment_plan'
));
