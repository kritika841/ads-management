import type { Profile } from "@/lib/types";

/** Whether a profile can interact with (comment on, etc.) a specific ad —
 *  admins/managers always can; a creator/editor needs to be the one assigned
 *  to this ad, or have been explicitly granted access as a collaborator. */
export function hasAdAccess(
  profile: Pick<Profile, "id" | "role">,
  ad: { creator_id: string | null; editor_id: string | null },
  collaboratorIds: Iterable<string>
) {
  if (profile.role === "admin" || profile.role === "manager") return true;
  const collaborators = collaboratorIds instanceof Set ? collaboratorIds : new Set(collaboratorIds);
  if (profile.role === "content_creator") return ad.creator_id === profile.id || collaborators.has(profile.id);
  if (profile.role === "editor") return ad.editor_id === profile.id || collaborators.has(profile.id);
  return true;
}
