import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, ExternalLink } from "lucide-react";
import { DeleteAdButton } from "@/components/dashboard/delete-ad-button";
import { AdVersionPreview } from "@/components/review/ad-version-preview";
import { CommentThread } from "@/components/review/comment-thread";
import { ReviewPanel } from "@/components/review/review-panel";
import { VideoTimestampProvider } from "@/components/review/video-timestamp-context";
import { VersionHistory } from "@/components/review/version-history";
import { Avatar } from "@/components/ui/avatar";
import { ActivityDrawer } from "@/components/workflow/activity-drawer";
import { CreatorItemForm } from "@/components/workflow/creator-item-form";
import { CreatorReviewActions } from "@/components/workflow/creator-review-actions";
import { EditorWorkspace } from "@/components/workflow/editor-workspace";
import { ProductionStageBadge } from "@/components/workflow/production-stage";
import { ReassignEditorButton } from "@/components/workflow/reassign-editor-button";
import { hasAdAccess } from "@/lib/ad-access";
import { requireProfile } from "@/lib/auth";
import { getAdDetail, getAppSettings, getCampaigns, getEditorInProgressCount, getEditorWorkloads, getProducts, getProfiles, getTags } from "@/lib/data";
import { canDeleteAd } from "@/lib/permissions";
import { creatorEditableStages, isFinalMediaVisible, productionStageLabels, workflowWaitingLabel } from "@/lib/production-workflow";
import type { ResubmissionFeedbackItem } from "@/lib/resubmission";
import type { AdWithRelations, Profile } from "@/lib/types";
import { formatDateOnly } from "@/lib/utils";

export default async function AdDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, profile] = await Promise.all([params, requireProfile()]);
  const [detail, campaigns, products, profiles, tags, editorWorkloads, editorInProgressCount, settings] = await Promise.all([
    getAdDetail(id),
    getCampaigns(),
    getProducts(),
    getProfiles(),
    getTags(),
    getEditorWorkloads(),
    profile.role === "editor" ? getEditorInProgressCount(profile.id) : Promise.resolve(0),
    getAppSettings()
  ]);

  if (!detail) notFound();

  const { ad, versions, comments, annotations, reviews, activity, collaboratorIds } = detail;
  const editors = profiles.filter((item) => item.role === "editor");
  const creators = profiles.filter((item) => item.role === "content_creator");
  const isReviewer = profile.role === "admin" || profile.role === "manager";
  const mentionableUsers = profiles
    .filter((item) => item.active && item.id !== profile.id)
    .map((item) => ({ ...item, hasAccess: hasAdAccess(item, ad, collaboratorIds) }));
  const isCreator = profile.role === "content_creator" && ad.creator_id === profile.id;
  const isAssignedEditor = profile.role === "editor" && ad.editor_id === profile.id;
  const creatorCanEdit = (isCreator || isReviewer) && creatorEditableStages.includes(ad.production_stage as (typeof creatorEditableStages)[number]);
  const editorHasTask = isAssignedEditor && ["ready_for_edit", "editing", "changes_requested"].includes(ad.production_stage);
  const creatorNeedsReview = isCreator && ad.production_stage === "creator_review";
  const canReassign = isReviewer && ["ready_for_edit", "editing", "changes_requested"].includes(ad.production_stage);
  const mediaVisible = isFinalMediaVisible(ad.production_stage);
  const latestVersionAt = versions[0]?.created_at ?? null;
  const resubmissionFeedback: ResubmissionFeedbackItem[] = [
    ...reviews
      .filter((review) => review.note && (review.decision === "request_changes" || review.decision === "reject") && (!latestVersionAt || review.created_at > latestVersionAt))
      .map((review) => ({
        id: `review-${review.id}`,
        body: review.note!,
        context: review.decision === "reject" ? "Rejection reason" : "Change request",
        authorName: review.reviewer?.name ?? "Reviewer",
        createdAt: review.created_at
      })),
    ...annotations
      .filter((annotation) => !latestVersionAt || annotation.created_at > latestVersionAt)
      .map((annotation) => ({
        id: `annotation-${annotation.id}`,
        body: annotation.body,
        context: annotation.kind === "video_timestamp" ? `${annotation.timestamp_seconds ?? 0}s video note` : "Script note",
        authorName: annotation.author?.name ?? "Reviewer",
        createdAt: annotation.created_at
      }))
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <main className="page-container">
        <header className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/library" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" aria-hidden />
              Creative library
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-foreground">{ad.name}</h1>
              <ProductionStageBadge stage={ad.production_stage} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {ad.campaign?.name ?? "No campaign"} · <span suppressHydrationWarning>{workflowWaitingLabel(ad.workflow_status_changed_at)}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActivityDrawer activity={activity} />
            {canDeleteAd(profile.role) ? <DeleteAdButton adId={ad.id} adName={ad.name} redirectAfterDelete /> : null}
          </div>
        </header>

        <section className="panel mb-5 flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-1 size-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{productionStageLabels[ad.production_stage]}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{nextStepText(ad)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Owner: <strong className="font-medium text-muted-foreground">{currentOwner(ad)}</strong></span>
            {canReassign ? <ReassignEditorButton ad={ad} editors={editors} workloads={editorWorkloads} /> : null}
          </div>
        </section>

        <VideoTimestampProvider>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 space-y-5">
            {mediaVisible && ad.drive_file_id ? <AdVersionPreview ad={ad} versions={versions} /> : null}

            {creatorCanEdit ? (
              <section className="panel overflow-hidden">
                <div className="border-b border-border p-5">
                  <h2 className="section-heading">Prepare content</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Keep the script and production status together. Assigning an editor completes the handoff.</p>
                </div>
                <div className="p-5">
                  <CreatorItemForm
                    profile={profile}
                    creators={creators}
                    editors={editors}
                    campaigns={campaigns.filter((item) => item.active)}
                    products={products.filter((item) => item.active)}
                    initialAd={ad}
                    availableTags={tags}
                    editorWorkloads={editorWorkloads}
                  />
                </div>
              </section>
            ) : null}

            {editorHasTask ? <EditorWorkspace ad={ad} feedback={resubmissionFeedback} inProgressCount={editorInProgressCount} maxConcurrentEdits={settings.max_concurrent_edits} /> : null}
            {creatorNeedsReview ? <CreatorReviewActions adId={ad.id} /> : null}

            <VersionHistory versions={versions} />
          </section>

          <aside className="space-y-5 xl:sticky xl:top-20 xl:self-start">
            <section className="panel p-5">
              <h2 className="section-heading">Content details</h2>
              <div className="mt-4 grid gap-4">
                <PersonSummary label="Created by" profile={ad.creator} fallback="Unknown creator" />
                <PersonSummary label="Edited by" profile={ad.editor} fallback="Unassigned editor" />
              </div>
              <dl className="mt-5 grid gap-3 border-t border-border pt-4 text-sm">
                <DetailRow label="Campaign" value={ad.campaign?.name ?? "No campaign"} />
                <DetailRow label="Product" value={ad.product?.name ?? "No product"} />
                <DetailRow label="Platforms" value={ad.platforms.join(", ") || "None"} />
                <DetailRow label="Versions" value={String(versions.length)} />
                {ad.deadline ? <DetailRow label="Deadline" value={formatDateOnly(ad.deadline)} icon={<CalendarClock className="size-4" aria-hidden />} /> : null}
              </dl>
              {ad.raw_footage_url && (isReviewer || isCreator || (isAssignedEditor && ad.production_stage !== "ready_for_edit")) ? (
                <a href={ad.raw_footage_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 border-t border-border pt-4 text-sm font-medium text-primary hover:underline">
                  Raw footage folder <ExternalLink className="size-4" aria-hidden />
                </a>
              ) : null}
              {ad.tags.length ? <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-4">{ad.tags.map((tag) => <span key={tag.id} className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-foreground">#{tag.name}</span>)}</div> : null}
            </section>

            {isReviewer ? <ReviewPanel ad={ad} profile={profile} reviews={reviews} annotations={annotations} /> : null}
            <CommentThread adId={ad.id} comments={comments} mentionableUsers={mentionableUsers} canGrantAccess={isReviewer} />
          </aside>
        </div>
        </VideoTimestampProvider>
      </main>
    </>
  );
}

function PersonSummary({ label, profile, fallback }: { label: string; profile: Pick<Profile, "name" | "avatar_url"> | null; fallback: string }) {
  return <div className="flex items-center gap-3">{profile ? <Avatar name={profile.name} src={profile.avatar_url} /> : <Avatar name={fallback} />}<div><p className="text-xs font-medium uppercase text-muted-foreground">{label}</p><p className="font-medium text-foreground">{profile?.name ?? fallback}</p></div></div>;
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <div className="flex justify-between gap-3 py-0.5"><dt className="inline-flex items-center gap-1 text-muted-foreground">{icon}{label}</dt><dd className="text-right font-medium text-foreground">{value}</dd></div>;
}

function currentOwner(ad: AdWithRelations) {
  if (["script_writing", "ready_to_shoot", "shoot_complete"].includes(ad.production_stage)) return ad.creator?.name ?? "Content creator";
  if (["ready_for_edit", "editing", "changes_requested"].includes(ad.production_stage)) return ad.editor?.name ?? "Editor not assigned";
  if (ad.production_stage === "creator_review") return `${ad.creator?.name ?? "Content creator"} or final reviewer`;
  if (ad.production_stage === "final_review") return "Manager or admin";
  return "Complete";
}

function nextStepText(ad: AdWithRelations) {
  const messages = {
    script_writing: "Complete the script, then move it toward the shoot.",
    ready_to_shoot: "The script is ready and production can begin.",
    shoot_complete: "Add the raw-footage folder and assign an editor when ready.",
    ready_for_edit: "The assigned editor can open the handoff and start editing.",
    editing: "The assigned editor is preparing the final video.",
    changes_requested: "The assigned editor must address the latest feedback and resubmit.",
    creator_review: "The creator may review it, or a manager/admin may approve directly.",
    final_review: "Waiting for final approval from a manager or admin.",
    approved: "Final approval is complete."
  } satisfies Record<AdWithRelations["production_stage"], string>;
  return messages[ad.production_stage];
}
