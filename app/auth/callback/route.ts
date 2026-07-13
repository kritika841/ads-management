import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const oauthError = requestUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(new URL("/login?error=oauth_denied", request.url));
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=oauth_exchange", request.url));
    }

    if (data.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("active")
        .eq("id", data.user.id)
        .maybeSingle();

      if (!profile?.active) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL("/login?inactive=1", request.url));
      }
    }
  } else {
    return NextResponse.redirect(new URL("/login?error=oauth_missing_code", request.url));
  }

  const destination = next?.startsWith("/") ? next : "/dashboard";
  return NextResponse.redirect(new URL(destination, request.url));
}
