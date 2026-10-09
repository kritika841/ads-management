import { RecycleBinPanel } from "@/components/admin/recycle-bin-panel";
import { requireRole } from "@/lib/auth";
import { listRecycleBin, purgeExpiredRecycleBin } from "@/lib/recycle-bin";

export const metadata = { title: "Recycle Bin – AdFlow" };
export const dynamic = "force-dynamic";

export default async function RecycleBinPage() {
  const profile = await requireRole(["admin", "manager"]);
  await purgeExpiredRecycleBin().catch(() => undefined);
  const snapshot = await listRecycleBin();

  return (
    <main className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Recycle Bin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleted campaigns, creatives and scripts stay here until their retention window ends. Restore anything you removed by mistake.
        </p>
      </div>
      <RecycleBinPanel snapshot={snapshot} role={profile.role === "admin" ? "admin" : "manager"} />
    </main>
  );
}
