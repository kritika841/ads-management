"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Chrome,
  Copy,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  Send,
  ShieldAlert
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { checkUserPasswordStatusAction, requestPasswordResetAction } from "@/app/actions/password";

export function LoginForm({
  initialMessage = null,
  initialEmail = "",
  initialExpired = false
}: {
  initialMessage?: string | null;
  initialEmail?: string;
  initialExpired?: boolean;
}) {
  const [email, setEmail] = useState(initialEmail || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [isPending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);

  // Password expiration lockout state
  const [isPasswordExpired, setIsPasswordExpired] = useState(initialExpired);
  const [resetSent, setResetSent] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [emailDelivered, setEmailDelivered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isResetPending, startResetTransition] = useTransition();

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (initialExpired) {
      setIsPasswordExpired(true);
    }
  }, [initialExpired]);

  function handlePasswordSignIn() {
    setShowPassword(false);
    setMessage(null);
    startTransition(async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (error) {
          setMessage(error.message);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("active")
          .eq("id", data.user.id)
          .maybeSingle();

        if (!profile?.active) {
          await supabase.auth.signOut();
          setMessage("Your account is not active yet. Ask an admin to approve it.");
          return;
        }

        // Check if password has expired (30-day lifecycle)
        const passwordStatus = await checkUserPasswordStatusAction(data.user.id);
        if (passwordStatus.isExpired) {
          await supabase.auth.signOut();
          setIsPasswordExpired(true);
          setMessage("Password expired. Your password has expired after 30 days.");
          return;
        }

        window.location.href = "/dashboard";
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to sign in.");
      }
    });
  }

  function handleSendResetEmail() {
    setResetMessage(null);
    startResetTransition(async () => {
      const targetEmail = email.trim();
      if (!targetEmail) {
        setResetMessage("Please provide your account email address.");
        return;
      }

      const clientOrigin = typeof window !== "undefined" ? window.location.origin : undefined;
      const res = await requestPasswordResetAction(targetEmail, clientOrigin);
      if (res.ok) {
        setResetSent(true);
        setResetMessage(res.message);
        setActionLink(res.actionLink || null);
        setEmailDelivered(Boolean(res.emailDelivered));
      } else {
        setResetMessage(res.message || "Failed to send password reset email.");
      }
    });
  }

  function handleGoogleSignIn() {
    setMessage(null);
    startTransition(async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback`
          }
        });
        if (error) {
          setMessage(error.message);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to start Google sign-in.");
      }
    });
  }

  // If locked out due to expired password, display high-clarity lockout authentication flow
  if (isPasswordExpired) {
    return (
      <div className="space-y-5" data-hydrated={hydrated}>
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-destructive">Password expired</h3>
              <p className="text-xs leading-relaxed text-destructive/90">
                Your password has expired after 30 days. To regain access to your AdFlow workspace, you must authenticate and regenerate a new password.
              </p>
            </div>
          </div>
        </div>

        {resetSent ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm text-foreground">
              <p className="font-medium text-primary">Password reset email sent!</p>
              <p className="mt-1 text-xs text-muted-foreground">
                A secure password reset link has been emailed to <strong>{email}</strong> via Google Workspace.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Please check your <strong>Inbox</strong>, <strong>Spam folder</strong>, or existing email threads from <em>AdFlow</em> / <em>support@satmi.in</em>.
              </p>
            </div>

            <Button
              variant="secondary"
              className="w-full text-xs"
              disabled={isResetPending}
              onClick={handleSendResetEmail}
              type="button"
            >
              {isResetPending ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <Send className="mr-2 size-3.5" />}
              Resend password reset email
            </Button>

            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setIsPasswordExpired(false);
                setResetSent(false);
                setMessage(null);
                setActionLink(null);
              }}
            >
              <ArrowLeft className="mr-2 size-4" />
              Return to sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Registered Account Email" htmlFor="expired-reset-email">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="expired-reset-email"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="name@satmi.in"
                />
              </div>
            </Field>

            {resetMessage ? (
              <p role="alert" className="rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-xs text-warning">
                {resetMessage}
              </p>
            ) : null}

            <Button
              className="w-full"
              disabled={isResetPending}
              onClick={handleSendResetEmail}
              type="button"
            >
              {isResetPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
              Send Password Reset Link via Email
            </Button>

            <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <HelpCircle className="size-4 text-muted-foreground" />
                <span>Need immediate access?</span>
              </div>
              <p className="mt-1">
                You can also contact your system administrator at{" "}
                <a
                  href={`mailto:admin@satmi.in?subject=${encodeURIComponent("Password Expired Unlock - " + email)}`}
                  className="font-medium text-primary hover:underline"
                >
                  admin@satmi.in
                </a>{" "}
                to unlock or issue a reset for your account.
              </p>
            </div>

            <Button
              variant="ghost"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setIsPasswordExpired(false);
                setMessage(null);
              }}
              type="button"
            >
              <ArrowLeft className="mr-1.5 size-3.5" />
              Try signing in with a different account
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      data-hydrated={hydrated}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        handlePasswordSignIn();
      }}
    >
      <Field label="Email" htmlFor="login-email">
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="login-email"
            className="pl-9"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            required
          />
        </div>
      </Field>

      <Field
        label={
          <span className="flex items-center justify-between">
            <span>Password</span>
            <Link
              href="/reset-password"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              Forgot password?
            </Link>
          </span>
        }
        htmlFor="login-password"
      >
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="login-password"
            className="px-9"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 select-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-muted-foreground"
            onPointerDown={(e) => {
              e.preventDefault();
              setShowPassword(true);
            }}
            onPointerUp={() => setShowPassword(false)}
            onPointerLeave={() => setShowPassword(false)}
            title="Hold to reveal"
            aria-label="Hold to reveal password"
          >
            {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
      </Field>

      {message ? (
        <p role="alert" className="rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
          {message}
        </p>
      ) : null}

      <Button className="w-full" disabled={isPending} type="submit">
        {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Sign in
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-medium text-muted-foreground">OR</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button className="w-full" variant="secondary" disabled={isPending} onClick={handleGoogleSignIn} type="button">
        <Chrome className="size-4" aria-hidden />
        Sign in with Google
      </Button>
    </form>
  );
}
