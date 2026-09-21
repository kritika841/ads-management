import { DailyTargetsClient } from "@/components/targets/daily-targets-client";
import { requireProfile } from "@/lib/auth";
import { dateInTargetTimeZone, monthBounds } from "@/lib/daily-targets";
import { getDailyTargetDaySettings, getDailyTaskRules, getDailyTargets, getProfiles } from "@/lib/data";

export const metadata = { title: "Daily Targets – AdFlow" };

export default async function DailyTargetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const [profile, params] = await Promise.all([requireProfile(), searchParams]);
  const today = dateInTargetTimeZone();
  const bounds = monthBounds(params.month ?? today.slice(0, 7));
  const canManage = profile.role === "admin" || profile.role === "manager";
  const visibleEnd = bounds.end < today ? bounds.end : today;
  const canLoadMonth = bounds.start <= today;
  const [targets, people, rules, daySettings] = await Promise.all([canLoadMonth ? getDailyTargets(bounds.start, visibleEnd) : Promise.resolve([]), canManage ? getProfiles() : Promise.resolve([profile]), canManage ? getDailyTaskRules() : Promise.resolve([]), canManage && canLoadMonth ? getDailyTargetDaySettings(bounds.start, visibleEnd) : Promise.resolve([])]);
  return <DailyTargetsClient profile={profile} profiles={people.filter((person) => person.active && ["editor", "content_creator"].includes(person.role))} targets={targets} month={bounds.month} today={today} rules={rules} daySettings={daySettings} />;
}
