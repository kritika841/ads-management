/**
 * Creator-capable roles.
 *
 * Content creators author creatives for themselves. Managers and admins inherit
 * the same behaviour: they can author creatives (and therefore appear in the
 * "Content creator" pickers) and run them through the same lifecycle.
 *   - content_creator → self only
 *   - manager         → self + content creators
 *   - admin           → self + managers + content creators
 */
export const creatorCapableRoles = ["content_creator", "manager", "admin"] as const;

export type CreatorCapableRole = (typeof creatorCapableRoles)[number];

type CreatorLike = { id: string; role: string; active?: boolean | null };

export function isCreatorCapableRole(role: string | null | undefined): role is CreatorCapableRole {
  return !!role && (creatorCapableRoles as readonly string[]).includes(role);
}

/** Whether `actor` is allowed to author a creative on behalf of `target`. */
export function canAssignCreator(actor: CreatorLike, target: CreatorLike) {
  if (target.active === false) return false;
  if (!isCreatorCapableRole(target.role)) return false;
  if (target.id === actor.id) return isCreatorCapableRole(actor.role);
  if (actor.role === "admin") return true;
  if (actor.role === "manager") return target.role === "content_creator";
  return false;
}

/**
 * Profiles the viewer can pick as the creator of a new creative. The viewer is
 * always listed first (when capable) so "yourself" is the natural default.
 */
export function eligibleCreatorsFor<T extends CreatorLike>(viewer: T, profiles: T[]): T[] {
  const others = profiles.filter((item) => item.id !== viewer.id && canAssignCreator(viewer, item));
  const self = canAssignCreator(viewer, viewer) ? [viewer] : [];
  return [...self, ...others];
}

/** Profiles that can ever appear as a creator (for filters/labels). */
export function creatorCapableProfiles<T extends CreatorLike>(profiles: T[]): T[] {
  return profiles.filter((item) => isCreatorCapableRole(item.role));
}
