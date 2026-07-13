"use client";

import { useState, useTransition } from "react";
import { Chrome, Eye, EyeOff, Loader2, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LoginForm({ initialMessage = null }: { initialMessage?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [isPending, startTransition] = useTransition();

  function handlePasswordSignIn() {
    setMessage(null);
    startTransition(async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
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

        window.location.href = "/dashboard";
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to sign in.");
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

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        handlePasswordSignIn();
      }}
    >
      <Field label="Email" htmlFor="login-email">
        <div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden /><Input
          id="login-email"
          className="pl-9"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          autoComplete="email"
          required
        /></div>
      </Field>
      <Field label="Password" htmlFor="login-password">
        <div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden /><Input
          id="login-password"
          className="px-9"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
        /><button type="button" className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setShowPassword((value) => !value)} title={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}</button></div>
      </Field>
      {message ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p> : null}
      <Button className="w-full" disabled={isPending} type="submit">
        {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Sign in
      </Button>
      <div className="flex items-center gap-3"><span className="h-px flex-1 bg-border" /><span className="text-[11px] font-medium text-slate-400">OR</span><span className="h-px flex-1 bg-border" /></div>
      <Button className="w-full" variant="secondary" disabled={isPending} onClick={handleGoogleSignIn} type="button">
        <Chrome className="size-4" aria-hidden />
        Sign in with Google
      </Button>
    </form>
  );
}
