import { AlertTriangle } from "lucide-react";

export function SetupState() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="w-full max-w-xl rounded-xl border border-warning/30 bg-card p-6 shadow-soft dark:shadow-none">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-warning/15 p-2 text-warning">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <div className="space-y-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground">AdFlow needs live credentials</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Add Supabase and Google values to `.env.local`, then run the
                migration in `supabase/migrations/0001_init.sql`.
              </p>
            </div>
            <pre className="overflow-x-auto rounded-md bg-neutral-950 p-4 text-xs text-neutral-100">
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
