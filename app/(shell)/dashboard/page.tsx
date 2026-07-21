import { HomeDashboard } from "@/components/dashboard/home-dashboard";
import { requireProfile } from "@/lib/auth";
import { getAds, getAppSettings, getEditorWorkloads, getProfiles, getEditorTimelineData, getEditorAverageEditTimes } from "@/lib/data";
import { buildDashboardSummary } from "@/lib/dashboard-summary";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const isReviewer = profile.role === "admin" || profile.role === "manager";
  
  const [ads, profiles, editorWorkloads, settings, timelineData, editorAverageEditTimes] = await Promise.all([
    getAds(), 
    getProfiles(), 
    getEditorWorkloads(), 
    getAppSettings(),
    isReviewer ? getEditorTimelineData(90) : Promise.resolve(undefined),
    isReviewer ? getEditorAverageEditTimes() : Promise.resolve(undefined)
  ]);
  
  const model = buildDashboardSummary({ 
    role: profile.role, 
    ads, 
    profiles, 
    editorWorkloads, 
    editorCapacity: settings.max_concurrent_edits,
    timelineData,
    editorAverageEditTimes
  });

  return <HomeDashboard model={model} />;
}
