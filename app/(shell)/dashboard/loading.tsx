export default function DashboardLoading() {
  return (
    <main className="page-container animate-pulse" aria-busy="true" aria-label="Loading dashboard">
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 rounded-lg bg-muted" />
        <div className="h-10 w-40 rounded-lg bg-muted" />
      </div>
      <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="bg-card px-4 py-4">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="mt-2 h-7 w-16 rounded-lg bg-muted" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="h-5 w-32 rounded bg-muted" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="size-10 rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
                <div className="h-6 w-20 rounded-full bg-muted" />
              </div>
            ))}
          </div>
        </div>
        <div className="panel p-5">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="h-4 w-1/2 rounded bg-muted" />
                <div className="h-6 w-16 rounded-full bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
