import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { AnnouncementsDashboard } from "@/components/announcements/announcements-dashboard";
import { getAnnouncementsWithStats } from "@/app/actions/announcements";

export const metadata = {
  title: "Announcements | AdFlow",
  description: "Create and track official team announcements and acknowledgement status."
};

export default async function AnnouncementsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    redirect("/dashboard");
  }

  const { announcements, allProfiles } = await getAnnouncementsWithStats();

  return (
    <main className="page-container py-6">
      <AnnouncementsDashboard
        announcements={announcements}
        allProfiles={allProfiles}
        profile={profile}
      />
    </main>
  );
}
