import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import {
  getCampaignDetail,
  getCampaigns,
  getEditorWorkloads,
  getProducts,
  getProfiles,
  getTags
} from "@/lib/data";
import { CampaignDetailClient } from "@/components/campaigns/campaign-detail-client";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, profile] = await Promise.all([params, requireProfile()]);

  const [overview, campaigns, products, profiles, tags, editorWorkloads] = await Promise.all([
    getCampaignDetail(id),
    getCampaigns(),
    getProducts(),
    getProfiles(),
    getTags(),
    getEditorWorkloads()
  ]);

  if (!overview) {
    notFound();
  }

  return (
    <CampaignDetailClient
      overview={overview}
      profile={profile}
      campaigns={campaigns}
      products={products}
      profiles={profiles}
      availableTags={tags}
      editorWorkloads={editorWorkloads}
    />
  );
}
