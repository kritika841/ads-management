export default function AnalyticsLoading() {
  return (
    <main className="page-container animate-pulse" aria-busy="true" aria-label="Loading analytics">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="h-7 w-32 rounded-lg bg-muted" />
          <div className="mt-2 h-4 w-64 rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-36 rounded-lg bg-muted" />
          <div className="h-10 w-28 rounded-lg bg-muted" />
        </div>
      </div>
      <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="bg-card px-4 py-4">
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="mt-2 h-7 w-20 rounded-lg bg-muted" />
            <div className="mt-1 h-3 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="mt-5 panel overflow-hidden">
        <div className="border-b border-border p-4">
          <div className="h-4 w-24 rounded bg-muted" />
        </div>
        <div className="p-4">
          <div className="h-56 rounded-lg bg-muted" />
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          <div className="border-b border-border p-4">
            <div className="h-4 w-32 rounded bg-muted" />
          </div>
          <div className="divide-y divide-border">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="flex items-center gap-4 px-4 py-3">
                <div className="h-4 w-28 rounded bg-muted" />
                <div className="ml-auto h-4 w-16 rounded bg-muted" />
                <div className="h-4 w-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
        <div className="panel overflow-hidden">
          <div className="border-b border-border p-4">
            <div className="h-4 w-36 rounded bg-muted" />
          </div>
          <div className="divide-y divide-border">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="flex items-center gap-4 px-4 py-3">
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="ml-auto h-4 w-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
