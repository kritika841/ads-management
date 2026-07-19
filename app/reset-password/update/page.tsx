"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [ready, setReady] = useState(false);

  // Supabase sends the user to this page with a session in the URL hash.
  // We wait for the SIGNED_IN event from the PASSWORD_RECOVERY flow.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    // Also check if there is already an active session (e.g. tab reload)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => listener.subscription.unsubscribe();
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
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          setMessage(error.message);
          return;
        }
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
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-md bg-card text-sm font-bold text-foreground">AF</span>
          <span>
            <span className="block text-xl font-semibold">AdFlow</span>
            <span className="block text-xs text-muted-foreground">Creative operations</span>
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
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-md bg-neutral-950 text-sm font-bold text-white">AF</span>
            <span>
              <span className="block text-lg font-semibold text-foreground">AdFlow</span>
              <span className="block text-xs text-muted-foreground">Creative operations</span>
            </span>
          </div>
          <div className="panel p-5 sm:p-7">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-foreground">New password</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {success ? "Password updated! Redirecting you to the dashboard…" : "Enter your new password below."}
              </p>
            </div>

            {success ? (
              <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
                <ShieldCheck className="size-4 shrink-0" aria-hidden />
                Your password has been updated successfully.
              </div>
            ) : !ready ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Verifying reset link…
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
