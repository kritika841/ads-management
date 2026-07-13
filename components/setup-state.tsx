import { AlertTriangle } from "lucide-react";

export function SetupState() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="w-full max-w-xl rounded-lg border border-amber-200 bg-white p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-amber-100 p-2 text-amber-700">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <div className="space-y-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-950">AdFlow needs live credentials</h1>
              <p className="mt-1 text-sm text-slate-600">
                Add Supabase and Google values to `.env.local`, then run the
                migration in `supabase/migrations/0001_init.sql`.
              </p>
            </div>
            <pre className="overflow-x-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">
              NEXT_PUBLIC_SUPABASE_URL{"\n"}
              NEXT_PUBLIC_SUPABASE_ANON_KEY{"\n"}
              SUPABASE_SERVICE_ROLE_KEY
            </pre>
          </div>
        </div>
      </section>
    </main>
  );
}
