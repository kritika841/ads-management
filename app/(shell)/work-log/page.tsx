import { WorkLogClient, type WorkLogPersonOption } from "@/components/admin/work-log-client";
import { requireRole } from "@/lib/auth";
import { getProfiles } from "@/lib/data";
import { buildWorkLogReport, normalizeWorkLogRange, workLogDayKey, type WorkLogReport } from "@/lib/work-log";
import { getWorkLogData } from "@/lib/work-log-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Work Log – AdFlow" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function WorkLogPage({
  searchParams
}: {
  searchParams: Promise<{ person?: string | string[]; from?: string | string[]; to?: string | string[]; month?: string | string[] }>;
}) {
  await requireRole(["admin", "manager"]);
  const query = await searchParams;
  const requestedMonth = first(query.month);
  const nowMs = Date.now();
  const todayKey = workLogDayKey(nowMs);
  let from: string;
  let to: string;

  if (requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)) {
    const [year, monthNum] = requestedMonth.split("-").map(Number);
    const count = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    from = `${requestedMonth}-01`;
    to = `${requestedMonth}-${String(count).padStart(2, "0")}`;
  } else if (first(query.from) || first(query.to)) {
    const range = normalizeWorkLogRange(first(query.from), first(query.to), nowMs);
    from = range.from;
    to = range.to;
  } else {
    // Default to the current month so the monthly calendar sheet has all days populated
    const currentMonth = todayKey.slice(0, 7);
    const [year, monthNum] = currentMonth.split("-").map(Number);
    const count = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    from = `${currentMonth}-01`;
    to = `${currentMonth}-${String(count).padStart(2, "0")}`;
  }

  const [profiles, data] = await Promise.all([getProfiles(), getWorkLogData(from, to)]);

  const people: WorkLogPersonOption[] = profiles
    .map((item) => ({ id: item.id, name: item.name, role: item.role, avatar_url: item.avatar_url ?? null, active: item.active }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const actorNames = Object.fromEntries(profiles.map((item) => [item.id, item.name]));

  const requested = first(query.person);
  const selectedId = requested && people.some((item) => item.id === requested) ? requested : "all";

  const reports: Record<string, WorkLogReport> = {};
  for (const person of people) {
    const report = buildWorkLogReport({ person, from, to, ads: data.ads, logs: data.logs, timeLogs: data.timeLogs, actorNames, nowMs });
    const hasActivity = report.summary.creativesTouched > 0 || report.summary.editingSeconds > 0;
    // Retain days and creatives for all active people so the team calendar sheet and day lightboxes work instantly
    if (person.id === selectedId || hasActivity) {
      reports[person.id] = report;
    }
  }

  return (
    <div className="px-4 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Team Work Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See everything a creator, editor or manager worked on in a day or date range — new submissions and every status change.
        </p>
      </div>
      <WorkLogClient people={people} reports={reports} from={from} to={to} today={workLogDayKey(nowMs)} selectedId={selectedId} />
    </div>
  );
}
