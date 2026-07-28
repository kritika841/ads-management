import { EditorPerformanceClient } from "@/components/admin/editor-performance-client";
import { requireRole } from "@/lib/auth";
import { getAds, getAllActivityLogs, getAllEditorTimeLogs, getProfiles } from "@/lib/data";

export const metadata = { title: "Editor Performance – AdFlow" };

export default async function EditorPerformancePage() {
  await requireRole(["admin", "manager"]);
  const [profiles, ads, timeLogs, activityLogs] = await Promise.all([
    getProfiles(),
    getAds(),
    getAllEditorTimeLogs(),
    getAllActivityLogs(),
  ]);

  return (
    <div className="px-4 py-8 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Editor Performance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track individual editor workloads, editing time, revision rounds, and completion rates.
        </p>
      </div>
      <EditorPerformanceClient profiles={profiles} ads={ads} timeLogs={timeLogs} activityLogs={activityLogs} />
    </div>
  );
}

