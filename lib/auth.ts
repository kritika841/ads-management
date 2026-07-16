import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

export async function getSessionUser() {
  if (!hasSupabaseEnv()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return user;
}

// Memoized per-request: the shared shell layout and the page it wraps both
// need the current profile, and this avoids querying it twice for one request.
export const getCurrentProfile = cache(async () => {
  const user = await getSessionUser();
  if (!user) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as Profile | null;
});

export async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  if (!profile.active) {
    redirect("/login?inactive=1");
  }

  return profile;
}

export async function requireRole(roles: UserRole[]) {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) {
    redirect("/dashboard");
  }

  return profile;
}

export function canReview(role: UserRole) {
  return role === "admin" || role === "manager";
}

export function canManageUsers(role: UserRole) {
  return role === "admin";
}
