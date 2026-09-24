export type IncentiveEvaluationMode = "cumulative" | "daily";
export type IncentiveEvaluationStatus = "gate_testing" | "gate_passed" | "winner" | "failed";
export type IncentiveDecisionStatus = "unreviewed" | "winner" | "loser" | "needs_iteration" | "keep_testing";
export type IncentiveStatus = "eligible" | "not_eligible" | "pending_testing" | "failed_cpa" | "approved_for_payout" | "paid";
export type PayoutStatus = "not_ready" | "pending" | "approved" | "paid";

export type MetaAd = {
  id: string;
  name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  creative_id: string | null;
  creative_name: string | null;
  thumbnail_url: string | null;
  status: string | null;
  effective_status: string | null;
  created_time: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  purchases: number;
  revenue: number;
  cpa: number | null;
  insights_from: string | null;
  insights_to: string | null;
  last_synced_at: string;
  matched_ad_id: string | null;
  matched_creator_id: string | null;
  matched_editor_id: string | null;
  detected_tag: string | null;
  auto_matched_at: string | null;
  matched_creative_name?: string | null;
  match_confidence?: "high" | "medium" | "low" | "unmatched" | null;
  manual_outcome?: IncentiveDecisionStatus | null;
  manual_outcome_at?: string | null;
  manual_outcome_by?: string | null;
  daily_metrics?: MetaDailyMetric[];
  assets?: MetaAdAsset[];
};

export type MetaDailyMetric = {
  metric_date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  purchases: number;
  revenue: number;
  synced_at?: string;
};

export type MetaAdAsset = {
  id: string;
  meta_ad_id: string;
  asset_label: string;
  asset_type: string | null;
  creative_id: string | null;
  thumbnail_url: string | null;
  source: string;
  daily_metrics: MetaDailyMetric[];
};

export type IncentiveCampaign = {
  id: string;
  name: string;
  product_id: string;
  daily_submission_target: number;
  target_cpa: number;
  gate_days: number;
  winner_window_days: number;
  evaluation_mode: IncentiveEvaluationMode;
  creator_incentive_amount: number;
  editor_incentive_amount: number;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
  meta_campaign_ids?: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  product?: { id: string; name: string; sku: string | null } | null;
};

export type IncentiveDailyMetric = {
  id?: string;
  incentive_creative_id: string;
  metric_date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  purchases: number;
  revenue: number;
  synced_at?: string;
};

export type IncentiveCreative = {
  id: string;
  incentive_campaign_id: string;
  ad_id: string;
  meta_ad_id: string;
  launched_on: string;
  evaluation_status: IncentiveEvaluationStatus;
  gate_evaluated_at: string | null;
  winner_evaluated_at: string | null;
  latest_cpa: number | null;
  latest_spend: number;
  latest_purchases: number;
  last_synced_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  creator_id: string | null;
  editor_id: string | null;
  attribution_source: "manual" | "auto";
  auto_matched_at: string | null;
  decision_status: IncentiveDecisionStatus;
  decision_source: "automatic" | "manual";
  incentive_status: IncentiveStatus;
  payout_status: PayoutStatus;
  payout_month: string | null;
  decision_note: string | null;
  backfill_classified_at?: string | null;
  decided_at: string | null;
  decided_by: string | null;
  campaign: IncentiveCampaign;
  creator: { id: string; name: string } | null;
  editor: { id: string; name: string } | null;
  ad: {
    id: string;
    name: string;
    creator_id: string | null;
    editor_id: string | null;
    thumbnail_url: string | null;
    preview_url: string | null;
    drive_file_id: string | null;
    resolved_video_url: string | null;
    creator: { id: string; name: string } | null;
    editor: { id: string; name: string } | null;
  };
  metrics: IncentiveDailyMetric[];
};

export type IncentiveEvaluation = {
  status: IncentiveEvaluationStatus;
  spend: number;
  purchases: number;
  cpa: number | null;
  observedDays: number;
  gateComplete: boolean;
  windowComplete: boolean;
};

export type IncentiveBackfillEvaluation = {
  outcome: "winner" | "failed";
  spend: number;
  purchases: number;
  cpa: number | null;
  observedDays: number;
  passesPricingCriteria: boolean;
};

export function evaluateIncentiveCreative(
  campaign: Pick<IncentiveCampaign, "target_cpa" | "gate_days" | "winner_window_days" | "evaluation_mode">,
  launchedOn: string,
  metrics: IncentiveDailyMetric[]
): IncentiveEvaluation {
  const rows = metrics
    .filter((row) => row.metric_date >= launchedOn)
    .sort((a, b) => a.metric_date.localeCompare(b.metric_date));
  const gateEnd = addDays(launchedOn, campaign.gate_days - 1);
  // The winner window is an extension after the initial gate, so 3 + 10 means 13 total days.
  const windowEnd = addDays(launchedOn, campaign.gate_days + campaign.winner_window_days - 1);
  const latestDate = rows.at(-1)?.metric_date;
  const gateComplete = Boolean(latestDate && latestDate >= gateEnd);
  const windowComplete = Boolean(latestDate && latestDate >= windowEnd);
  const totals = rows
    .filter((row) => row.metric_date <= windowEnd)
    .reduce((sum, row) => ({ spend: sum.spend + Number(row.spend), purchases: sum.purchases + Number(row.purchases) }), { spend: 0, purchases: 0 });
  const cpa = totals.purchases > 0 ? totals.spend / totals.purchases : null;
  const passes = (through: string) => {
    const scoped = rows.filter((row) => row.metric_date <= through);
    if (campaign.evaluation_mode === "daily") {
      return scoped.length > 0 && scoped.every((row) => Number(row.purchases) > 0 && Number(row.spend) / Number(row.purchases) <= Number(campaign.target_cpa));
    }
    const aggregate = scoped.reduce((sum, row) => ({ spend: sum.spend + Number(row.spend), purchases: sum.purchases + Number(row.purchases) }), { spend: 0, purchases: 0 });
    return aggregate.purchases > 0 && aggregate.spend / aggregate.purchases <= Number(campaign.target_cpa);
  };

  let status: IncentiveEvaluationStatus = "gate_testing";
  if (gateComplete && !passes(gateEnd)) status = "failed";
  else if (windowComplete) status = passes(windowEnd) ? "winner" : "failed";
  else if (gateComplete) status = "gate_passed";

  return { status, spend: totals.spend, purchases: totals.purchases, cpa, observedDays: rows.length, gateComplete, windowComplete };
}

/**
 * Historical classification only. Unlike the live evaluator above, this does
 * not require a gate or winner window to have elapsed. New campaign tracking
 * must continue using evaluateIncentiveCreative.
 */
export function evaluateIncentiveCreativeBackfill(
  campaign: Pick<IncentiveCampaign, "target_cpa" | "evaluation_mode">,
  launchedOn: string,
  metrics: IncentiveDailyMetric[]
): IncentiveBackfillEvaluation {
  const rows = metrics.filter((row) => row.metric_date >= launchedOn);
  const totals = rows.reduce((sum, row) => ({ spend: sum.spend + Number(row.spend), purchases: sum.purchases + Number(row.purchases) }), { spend: 0, purchases: 0 });
  const cpa = totals.purchases > 0 ? totals.spend / totals.purchases : null;
  const passesPricingCriteria = campaign.evaluation_mode === "daily"
    ? rows.length > 0 && rows.every((row) => Number(row.purchases) > 0 && Number(row.spend) / Number(row.purchases) <= Number(campaign.target_cpa))
    : totals.purchases > 0 && totals.spend / totals.purchases <= Number(campaign.target_cpa);
  return { outcome: passesPricingCriteria ? "winner" : "failed", spend: totals.spend, purchases: totals.purchases, cpa, observedDays: rows.length, passesPricingCriteria };
}

export function isDiscontinuedMetaStatus(status: string | null | undefined) {
  return ["PAUSED", "ARCHIVED", "DELETED", "DISAPPROVED", "WITH_ISSUES"].includes(String(status ?? "").toUpperCase());
}

export function calculateMonthlyIncentive(amountPerWinner: number, winnerCount: number) {
  return Number(amountPerWinner) * winnerCount;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
