import { DailyTargetsClient } from "@/components/targets/daily-targets-client";
import { requireProfile } from "@/lib/auth";
import { dateInTargetTimeZone, monthBounds } from "@/lib/daily-targets";
import { getDailyTargets, getProfiles } from "@/lib/data";

export const metadata = { title: "Daily Targets – AdFlow" };

export default async function DailyTargetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const [profile, params] = await Promise.all([requireProfile(), searchParams]);
  const today = dateInTargetTimeZone();
  const bounds = monthBounds(params.month ?? today.slice(0, 7));
  const canManage = profile.role === "admin" || profile.role === "manager";
  const [targets, people] = await Promise.all([getDailyTargets(bounds.start, bounds.end), canManage ? getProfiles() : Promise.resolve([profile])]);
  return <DailyTargetsClient profile={profile} profiles={people.filter((person) => person.active && ["editor", "content_creator"].includes(person.role))} targets={targets} month={bounds.month} today={today} />;
}
