"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  RotateCcw,
  ShieldCheck
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { resetPasswordWithPolicyAction } from "@/app/actions/password";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Verification states: "verifying" | "ready" | "error"
  const [authStatus, setAuthStatus] = useState<"verifying" | "ready" | "error">("verifying");
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const supabase = createSupabaseBrowserClient();

    const markReady = () => {
      if (isMounted) {
        setAuthStatus("ready");
        setAuthError(null);
      }
    };

    const markError = (err: string) => {
      if (isMounted) {
        setAuthStatus("error");
        setAuthError(err);
      }
    };

    // 1. Inspect URL search params and hash fragment for error returns
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

      const error = searchParams.get("error") || hashParams.get("error");
      const errorDescription = searchParams.get("error_description") || hashParams.get("error_description");
      const errorCode = searchParams.get("error_code") || hashParams.get("error_code");

      if (error || errorCode) {
        const readableError = errorDescription
          ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
          : "The password reset link is invalid or has expired. Please request a new link.";
        markError(readableError);
        return;
      }

      // 2. Check for access_token in hash fragment or query string (Supabase recovery redirect)
      const accessToken = hashParams.get("access_token") || searchParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token") || searchParams.get("refresh_token") || "";
      if (accessToken) {
        supabase.auth
          .setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })
          .then(({ data, error: sessionErr }) => {
            if (!sessionErr && (data.session || data.user)) {
              markReady();
            } else if (sessionErr) {
              markError(sessionErr.message || "Failed to establish password recovery session.");
            }
          })
          .catch((err) => markError(err?.message || "Failed to authenticate recovery token."));
        return;
      }

      // 3. Check for token_hash in search params (direct OTP verification)
      const tokenHash = searchParams.get("token_hash");
      const type = (searchParams.get("type") as "recovery" | null) || "recovery";
      if (tokenHash) {
        supabase.auth
          .verifyOtp({ token_hash: tokenHash, type })
          .then(({ error: otpErr }) => {
            if (otpErr) {
              markError(otpErr.message || "Failed to verify reset token.");
            } else {
              markReady();
            }
          })
          .catch((err) => markError(err?.message || "Verification failed."));
        return;
      }

      // 4. Check for PKCE code in search params
      const code = searchParams.get("code");
      if (code) {
        supabase.auth
          .exchangeCodeForSession(code)
          .then(({ error: codeErr }) => {
            if (codeErr) {
              // Before failing, check if the session is already established
              supabase.auth.getSession().then(({ data }) => {
                if (data.session) {
                  markReady();
                } else {
                  markError(codeErr.message || "Failed to exchange reset code.");
                }
              });
            } else {
              markReady();
            }
          })
          .catch((err) => markError(err?.message || "Exchange failed."));
        return;
      }
    } catch {
      // ignore URL parsing errors
    }

    // 5. Listen for auth state changes (e.g. PASSWORD_RECOVERY, SIGNED_IN)
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        markReady();
      }
    });

    // 6. Check if session already active (e.g. set by server callback or existing cookie)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        markReady();
      }
    });

    // 7. Timeout safeguard: after 10 seconds, if still verifying, verify once more with getUser()
    const timer = setTimeout(async () => {
      if (isMounted) {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (user) {
          markReady();
        } else {
          setAuthStatus((prev) => {
            if (prev === "verifying") {
              setAuthError(
                "Link verification timed out or the link has expired. Please request a fresh reset link."
              );
              return "error";
            }
            return prev;
          });
        }
      }
    }, 10000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      listener.subscription.unsubscribe();
    };
  }, []);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user }
        } = await supabase.auth.getUser();

        const result = await resetPasswordWithPolicyAction({
          newPassword: password,
          confirmPassword,
          userId: user?.id
        });

        if (!result.ok) {
          setMessage(result.error || "Failed to update password.");
          return;
        }

        // Also sync client session if applicable
        await supabase.auth.updateUser({ password }).catch(() => null);

        setSuccess(true);
        setTimeout(() => router.push("/dashboard"), 2000);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <main className="grid min-h-screen bg-card lg:grid-cols-[minmax(360px,0.8fr)_minmax(520px,1.2fr)]">
      <section className="relative hidden overflow-hidden bg-neutral-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="flex flex-col items-start gap-1">
          <img src="/logo-dark.png" alt="Satmi" className="h-9 w-auto max-w-[130px] object-contain" />
          <span className="text-lg font-semibold tracking-tight text-white/90">
            AdFlow
          </span>
        </div>
        <div className="max-w-md">
          <p className="text-sm font-medium text-primary">Account recovery</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight">Set a new<br />password</h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">Choose a strong password to keep your AdFlow account secure.</p>
        </div>
        <p className="text-xs text-muted-foreground">Restricted to approved team members</p>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-muted px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-start gap-1 lg:hidden">
            <img src="/logo-light.png" alt="Satmi" className="h-8 w-auto max-w-[120px] object-contain dark:hidden" />
            <img src="/logo-dark.png" alt="Satmi" className="hidden h-8 w-auto max-w-[120px] object-contain dark:block" />
            <span className="text-base font-semibold tracking-tight text-foreground">
              AdFlow
            </span>
          </div>
          <div className="panel p-5 sm:p-7">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-foreground">New password</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {success
                  ? "Password updated! Redirecting you to the dashboard…"
                  : authStatus === "error"
                  ? "Password recovery verification notice"
                  : "Enter your new password below."}
              </p>
            </div>

            {success ? (
              <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
                <ShieldCheck className="size-4 shrink-0" aria-hidden />
                Your password has been updated successfully.
              </div>
            ) : authStatus === "error" ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">Unable to verify reset link</h3>
                      <p className="text-xs leading-relaxed opacity-90">
                        {authError || "This password reset link is invalid, has expired, or was already used."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Link href="/reset-password" className="block w-full">
                    <Button className="w-full" type="button">
                      <RotateCcw className="mr-2 size-4" />
                      Request a New Reset Link
                    </Button>
                  </Link>
                  <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="size-4" aria-hidden />
                    Back to sign in
                  </Link>
                </div>
              </div>
            ) : authStatus === "verifying" ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
                <p className="mt-3 text-sm font-medium text-foreground">Verifying reset link…</p>
                <p className="mt-1 text-xs text-muted-foreground">Authenticating your secure recovery token</p>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <Field label="New password" htmlFor="new-password">
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      id="new-password"
                      className="px-9"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 select-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                      onPointerDown={(e) => { e.preventDefault(); setShowPassword(true); }}
                      onPointerUp={() => setShowPassword(false)}
                      onPointerLeave={() => setShowPassword(false)}
                      title="Hold to reveal"
                      aria-label="Hold to reveal password"
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                </Field>

                <Field label="Confirm new password" htmlFor="confirm-password">
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      id="confirm-password"
                      className="px-9"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      type={showConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 select-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                      onPointerDown={(e) => { e.preventDefault(); setShowConfirm(true); }}
                      onPointerUp={() => setShowConfirm(false)}
                      onPointerLeave={() => setShowConfirm(false)}
                      title="Hold to reveal"
                      aria-label="Hold to reveal confirm password"
                    >
                      {showConfirm ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                </Field>

                {message ? (
                  <p role="alert" className="rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
                    {message}
                  </p>
                ) : null}

                <Button className="w-full" disabled={isPending} type="submit">
                  {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
                  Update password
                </Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
