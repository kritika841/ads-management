import { AppShell } from "@/components/app-shell";
import { SetupState } from "@/components/setup-state";
import { requireRole } from "@/lib/auth";
import { getAuditLogs, getNotifications } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export default async function AuditPage() {
  if (!hasSupabaseEnv()) {
    return <SetupState />;
  }

  const profile = await requireRole(["admin"]);
  const [logs, notifications] = await Promise.all([getAuditLogs(), getNotifications(profile.id)]);

  return (
    <AppShell profile={profile} notifications={notifications}>
      <main className="page-container">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-950">Audit Log</h1>
          <p className="mt-1 text-sm text-slate-500">Latest administrative and workflow events.</p>
        </div>
        <section className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="border-b border-border bg-slate-50/80 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id} className="transition hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-medium capitalize text-slate-950">{log.action.replaceAll("_", " ")}</td>
                    <td className="px-4 py-3 text-slate-600">{log.actor?.name ?? "System"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {log.target_type} {log.target_id ? `#${log.target_id.slice(0, 8)}` : ""}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(log.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
