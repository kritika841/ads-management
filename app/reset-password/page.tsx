"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, KeyRound, Loader2, Mail, Send } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { requestPasswordResetAction } from "@/app/actions/password";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [emailDelivered, setEmailDelivered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const trimmedEmail = email.trim();
        const clientOrigin = typeof window !== "undefined" ? window.location.origin : undefined;

        const res = await requestPasswordResetAction(trimmedEmail, clientOrigin);
        if (res.ok) {
          setSent(true);
          setIsAdmin(Boolean(res.isAdmin));
          setActionLink(res.actionLink || null);
          setEmailDelivered(Boolean(res.emailDelivered));
        } else {
          setMessage(res.message || "Something went wrong. Please try again.");
        }
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
          <h1 className="mt-3 text-4xl font-semibold leading-tight">Forgot your<br />password?</h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">Enter your team email and we&apos;ll send you a secure link to reset your password.</p>
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
              <h2 className="text-2xl font-semibold text-foreground">Reset password</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {sent ? "Check your inbox for a reset link." : "We'll email you a secure link to set a new password."}
              </p>
            </div>

            {sent ? (
              <div className="space-y-4">
                <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
                  A password reset link has been emailed to <strong>{email}</strong>. Please check your inbox (and spam folder) and click the link to set your new password.
                </div>

                {/* Only authenticated administrators are allowed to bypass email delivery with direct reset tools */}
                {isAdmin && actionLink ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                    <p className="font-semibold">Administrator Tools:</p>
                    <p className="mt-0.5 opacity-90">Direct reset link generated for team administrator access.</p>
                    <div className="mt-2.5 space-y-2">
                      <a href={actionLink} className="block w-full">
                        <Button className="w-full text-xs" type="button" size="sm">
                          <KeyRound className="mr-2 size-3.5" />
                          Set New Password Now (Admin)
                        </Button>
                      </a>
                      <Button
                        variant="secondary"
                        className="w-full text-xs"
                        size="sm"
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(actionLink);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        <Copy className="mr-1.5 size-3" />
                        {copied ? "Copied reset link!" : "Copy Direct Reset Link"}
                      </Button>
                    </div>
                  </div>
                ) : null}

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
