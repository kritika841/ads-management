import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const token_hash = requestUrl.searchParams.get("token_hash");
  const type = (requestUrl.searchParams.get("type") as EmailOtpType | null) || "recovery";
  const next = requestUrl.searchParams.get("next");
  const oauthError = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  const isResetPasswordFlow = Boolean(next?.includes("reset-password"));

  if (oauthError) {
    const targetUrl = isResetPasswordFlow
      ? `/reset-password/update?error=${encodeURIComponent(oauthError)}&error_description=${encodeURIComponent(errorDescription || oauthError)}`
      : `/login?error=oauth_denied`;
    return NextResponse.redirect(new URL(targetUrl, request.url));
  }

  // 1. Direct OTP token_hash verification (official Supabase PKCE / Server-side email verification)
  if (token_hash) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type
    });

    if (error) {
      console.error("[auth/callback] verifyOtp error:", error.message);
      const targetUrl = isResetPasswordFlow
        ? `/reset-password/update?error=invalid_token&error_description=${encodeURIComponent(error.message)}`
        : `/login?error=auth_verify_failed&error_description=${encodeURIComponent(error.message)}`;
      return NextResponse.redirect(new URL(targetUrl, request.url));
    }

    if (data?.user && !isResetPasswordFlow) {
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

    const destination = next?.startsWith("/") ? next : "/dashboard";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  // 2. PKCE code exchange
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchangeCodeForSession error:", error.message);
      const targetUrl = isResetPasswordFlow
        ? `/reset-password/update?error=oauth_exchange&error_description=${encodeURIComponent(error.message)}`
        : `/login?error=oauth_exchange`;
      return NextResponse.redirect(new URL(targetUrl, request.url));
    }

    if (data.user && !isResetPasswordFlow) {
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

    const destination = next?.startsWith("/") ? next : "/dashboard";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  // 3. Neither code nor token_hash provided in server query string
  // If this is a password reset flow, serve a client-side HTML forwarder so that
  // the URL hash fragment (#access_token=...) is preserved and delivered to /reset-password/update
  if (isResetPasswordFlow) {
    const destination = next?.startsWith("/") ? next : "/reset-password/update";
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Verifying reset link...</title>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #cbd5e1; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <p>Authenticating your reset link, please wait...</p>
  <script>
    var dest = ${JSON.stringify(destination)};
    var hash = window.location.hash || "";
    window.location.replace(dest + hash);
  </script>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0"
      }
    });
  }

  return NextResponse.redirect(new URL("/login?error=oauth_missing_code", request.url));
}
