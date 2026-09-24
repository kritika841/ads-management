import { requireProfile } from "@/lib/auth";
import { AnnouncementsDashboard } from "@/components/announcements/announcements-dashboard";
import { UserAnnouncementsFeed } from "@/components/announcements/user-announcements-feed";
import { getAnnouncementsWithStats, getUserAnnouncements } from "@/app/actions/announcements";

export const metadata = {
  title: "Announcements | AdFlow",
  description: "View and track official team announcements and acknowledgement status."
};

export default async function AnnouncementsPage() {
  const profile = await requireProfile();

  if (profile.role === "admin" || profile.role === "manager") {
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

  const userAnnouncements = await getUserAnnouncements();

  return (
    <main className="page-container py-6">
      <UserAnnouncementsFeed
        initialAnnouncements={userAnnouncements}
        profile={profile}
      />
    </main>
  );
}
