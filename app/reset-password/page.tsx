"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Mail, Send } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password/update`
        });
        if (error) {
          setMessage(error.message);
          return;
        }
        setSent(true);
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
          <h1 className="mt-3 text-4xl font-semibold leading-tight">Forgot your<br />password?</h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">Enter your team email and we'll send you a secure link to reset your password.</p>
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
              <h2 className="text-2xl font-semibold text-foreground">Reset password</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {sent ? "Check your inbox for a reset link." : "We'll email you a secure link to set a new password."}
              </p>
            </div>

            {sent ? (
              <div className="space-y-4">
                <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
                  A password reset link has been sent to <strong>{email}</strong>. Check your inbox (and spam folder).
                </div>
                <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="size-4" aria-hidden />
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <Field label="Email" htmlFor="reset-email">
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      id="reset-email"
                      className="pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      autoComplete="email"
                      placeholder="you@yourteam.com"
                      required
                    />
                  </div>
                </Field>

                {message ? (
                  <p role="alert" className="rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
                    {message}
                  </p>
                ) : null}

                <Button className="w-full" disabled={isPending} type="submit">
                  {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                  Send reset link
                </Button>

                <Link href="/login" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="size-4" aria-hidden />
                  Back to sign in
                </Link>
              </form>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
