import { TagsClient } from "@/components/admin/tags-client";
import { requireRole } from "@/lib/auth";
import { getTagOverview } from "@/lib/tags-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tags – AdFlow", description: "Browse every tag, see the creatives in it and remove tags you no longer need." };

export default async function TagsPage({ searchParams }: { searchParams: Promise<{ tag?: string | string[] }> }) {
  await requireRole(["admin", "manager"]);
  const [query, tags] = await Promise.all([searchParams, getTagOverview()]);
  const requested = Array.isArray(query.tag) ? query.tag[0] : query.tag;

  return (
    <div className="px-4 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Tags</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every tag used in the Creative Library. Pick a tag to see its creatives, or delete tags you no longer need.</p>
      </div>
      <TagsClient tags={tags} initialTagId={tags.find((tag) => tag.id === requested || tag.name === requested)?.id ?? null} />
    </div>
  );
}
