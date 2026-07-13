import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { SetupState } from "@/components/setup-state";
import { getCurrentProfile } from "@/lib/auth";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ inactive?: string; error?: string }>;
}) {
  if (!hasSupabaseEnv()) {
    return <SetupState />;
  }

  const profile = await getCurrentProfile();
  if (profile?.active) {
    redirect("/dashboard");
  }

  const query = await searchParams;
  const initialMessage = query.inactive
    ? "Your account is not active yet. Ask an admin to approve it."
    : query.error
      ? query.error === "oauth_denied"
        ? "Google sign-in was cancelled or denied. Please try again."
        : "Google sign-in could not be completed. Use an approved team account and try again."
      : null;

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[minmax(360px,0.8fr)_minmax(520px,1.2fr)]">
      <section className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-md bg-white text-sm font-bold text-slate-950">AF</span><span><span className="block text-xl font-semibold">AdFlow</span><span className="block text-xs text-slate-400">Creative operations</span></span></div>
        <div className="max-w-md"><p className="text-sm font-medium text-teal-300">Internal workspace</p><h1 className="mt-3 text-4xl font-semibold leading-tight">Creative work,<br />kept moving.</h1><p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">One place for submissions, feedback, versions, and approvals.</p></div>
        <p className="text-xs text-slate-500">Restricted to approved team members</p>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><span className="flex size-10 items-center justify-center rounded-md bg-slate-950 text-sm font-bold text-white">AF</span><span><span className="block text-lg font-semibold text-slate-950">AdFlow</span><span className="block text-xs text-slate-500">Creative operations</span></span></div>
          <div className="panel p-5 sm:p-7">
            <div className="mb-6"><h2 className="text-2xl font-semibold text-slate-950">Welcome back</h2><p className="mt-1.5 text-sm text-slate-500">Sign in with your approved team account.</p></div>
            <LoginForm initialMessage={initialMessage} />
          </div>
        </div>
      </section>
    </main>
  );
}
