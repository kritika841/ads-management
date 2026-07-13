import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/0001_init.sql", "utf8");
const bootstrapMigration = readFileSync("supabase/migrations/0002_bootstrap_defaults.sql", "utf8");
const roleMigration = readFileSync("supabase/migrations/0003_content_creators_and_video_editors.sql", "utf8");
const attributionMigration = readFileSync("supabase/migrations/0004_creator_editor_attribution.sql", "utf8");
const securityMigration = readFileSync("supabase/migrations/0007_security_and_version_snapshots.sql", "utf8");
const firstAdminMigration = readFileSync("supabase/migrations/0008_first_admin_bootstrap.sql", "utf8");
const productionWorkflowMigration = readFileSync("supabase/migrations/0009_production_workflow.sql", "utf8");
const simplifiedWorkflowMigration = readFileSync("supabase/migrations/0010_simplified_role_workflow.sql", "utf8");
const realtimeMigration = readFileSync("supabase/migrations/0011_realtime_workflow_updates.sql", "utf8");
const syncStateMigration = readFileSync("supabase/migrations/0012_user_sync_state.sql", "utf8");
const analyticsSlaMigration = readFileSync("supabase/migrations/0015_analytics_sla_targets.sql", "utf8");
const workflowIntegrityMigration = readFileSync("supabase/migrations/0016_workflow_integrity.sql", "utf8");
const atomicSubmissionMigration = readFileSync("supabase/migrations/0017_atomic_submission_and_tags.sql", "utf8");
const atomicEditorTransitionsMigration = readFileSync("supabase/migrations/0018_atomic_editor_transitions.sql", "utf8");

describe("database migration", () => {
  it("enables RLS on core tables", () => {
    for (const table of ["profiles", "ads", "ad_versions", "notifications", "audit_logs"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
    }
  });

  it("preserves soft user deactivation and historical attribution", () => {
    expect(migration).toContain("active boolean not null default true");
    expect(roleMigration).toContain("add value if not exists 'content_creator'");
    expect(attributionMigration).toContain("creator_id uuid references public.profiles(id)");
    expect(attributionMigration).toContain("alter column editor_id drop not null");
  });

  it("enforces unique ad names per campaign", () => {
    expect(migration).toContain("create unique index ads_campaign_lower_name_unique");
  });

  it("bootstraps an admin and default campaign", () => {
    expect(bootstrapMigration).toContain("values ('General'");
    expect(bootstrapMigration).toContain("not exists");
    expect(bootstrapMigration).toContain("resolved_role := 'admin'");
  });

  it("blocks inactive users and protects profile roles", () => {
    expect(securityMigration).toContain("using (public.current_profile_role() is not null)");
    expect(securityMigration).toContain('drop policy if exists "users update their own basic profile"');
  });

  it("creates version snapshots atomically under a row lock", () => {
    expect(securityMigration).toContain("function public.snapshot_ad_version");
    expect(securityMigration).toContain("for update;");
    expect(securityMigration).toContain("grant execute on function public.snapshot_ad_version");
  });

  it("activates only the first bootstrap admin", () => {
    expect(firstAdminMigration).toContain("is_first_profile boolean");
    expect(firstAdminMigration).toContain("resolved_role := 'admin'");
    expect(firstAdminMigration).toContain("is_first_profile\n  )");
  });

  it("tracks production stages and milestone timestamps", () => {
    expect(productionWorkflowMigration).toContain("production_stage text not null default 'script_writing'");
    expect(productionWorkflowMigration).toContain("raw_footage_url text");
    expect(productionWorkflowMigration).toContain("script_ready_at timestamptz");
    expect(productionWorkflowMigration).toContain("final_approved_at timestamptz");
    expect(productionWorkflowMigration).toContain("ads_production_stage_check");
  });

  it("makes one workflow stage canonical and synchronizes analytics status", () => {
    expect(simplifiedWorkflowMigration).toContain("workflow_status_changed_at timestamptz not null default now()");
    expect(simplifiedWorkflowMigration).toContain("'changes_requested'");
    expect(simplifiedWorkflowMigration).toContain("function public.sync_ad_workflow_status()");
    expect(simplifiedWorkflowMigration).toContain("new.status = case");
    expect(simplifiedWorkflowMigration).toContain("before insert or update on public.ads");
  });

  it("restricts creators and editors to their own workflow rows", () => {
    expect(simplifiedWorkflowMigration).toContain('drop policy if exists "active users view team ads"');
    expect(simplifiedWorkflowMigration).toContain('create policy "creators view own ads"');
    expect(simplifiedWorkflowMigration).toContain("creator_id = auth.uid()");
    expect(simplifiedWorkflowMigration).toContain('create policy "editors view assigned ads"');
    expect(simplifiedWorkflowMigration).toContain("editor_id = auth.uid()");
    expect(simplifiedWorkflowMigration).toContain('create policy "users comment on accessible ads"');
    expect(simplifiedWorkflowMigration).toContain('create policy "versions insertable with ad access"');
  });

  it("publishes workflow updates for realtime clients", () => {
    expect(realtimeMigration).toContain("supabase_realtime");
    for (const table of ["ads", "comments", "review_actions", "annotations", "activity_logs", "notifications"]) {
      expect(realtimeMigration).toContain(`'${table}'`);
    }
  });

  it("exposes an RLS-invoker sync fingerprint only to authenticated users", () => {
    expect(syncStateMigration).toContain("function public.get_user_sync_state()");
    expect(syncStateMigration).toContain("security invoker");
    expect(syncStateMigration).toContain("editor_id = auth.uid()");
    expect(syncStateMigration).toContain("production_stage = 'ready_for_edit'");
    expect(syncStateMigration).toContain("revoke all on function public.get_user_sync_state() from public, anon");
    expect(syncStateMigration).toContain("grant execute on function public.get_user_sync_state() to authenticated");
  });

  it("adds validated operational SLA targets with the agreed defaults", () => {
    expect(analyticsSlaMigration).toContain("assignment_start_sla_hours int not null default 12");
    expect(analyticsSlaMigration).toContain("editing_sla_hours int not null default 48");
    expect(analyticsSlaMigration).toContain("creator_review_sla_hours int not null default 24");
    expect(analyticsSlaMigration).toContain("final_review_sla_hours int not null default 24");
    expect(analyticsSlaMigration).toContain("revision_sla_hours int not null default 24");
    expect(analyticsSlaMigration).toContain("between 1 and 720");
  });

  it("removes legacy editor writes and makes review transitions atomic", () => {
    expect(workflowIntegrityMigration).toContain('drop policy if exists "editors create own ads"');
    expect(workflowIntegrityMigration).toContain('drop policy if exists "editors update editable own ads"');
    expect(workflowIntegrityMigration).toContain("function public.creator_review_ad_atomic");
    expect(workflowIntegrityMigration).toContain("function public.final_review_ad_atomic");
    expect(workflowIntegrityMigration).toContain("for update;");
    expect(workflowIntegrityMigration).toContain("insert into public.review_actions");
    expect(workflowIntegrityMigration).toContain("insert into public.activity_logs");
    expect(workflowIntegrityMigration).toContain("grant execute on function public.final_review_ad_atomic");
  });

  it("saves submission versions and tag replacements atomically", () => {
    expect(atomicSubmissionMigration).toContain("function public.sync_ad_tags_atomic");
    expect(atomicSubmissionMigration).toContain("function public.submit_edited_video_atomic");
    expect(atomicSubmissionMigration).toContain("perform public.snapshot_ad_version");
    expect(atomicSubmissionMigration).toContain("insert into public.activity_logs");
    expect(atomicSubmissionMigration).toContain("grant execute on function public.submit_edited_video_atomic");
  });

  it("updates editor assignment stages and activity in one transaction", () => {
    expect(atomicEditorTransitionsMigration).toContain("function public.transition_editor_work_atomic");
    expect(atomicEditorTransitionsMigration).toContain("for update;");
    expect(atomicEditorTransitionsMigration).toContain("p_action = 'start_editing'");
    expect(atomicEditorTransitionsMigration).toContain("p_action = 'assign_editor'");
    expect(atomicEditorTransitionsMigration).toContain("p_action = 'reassign_editor'");
    expect(atomicEditorTransitionsMigration).toContain("insert into public.activity_logs");
  });
});
