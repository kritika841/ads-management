export default function SettingsLoading() {
  return (
    <main className="page-container animate-pulse" aria-busy="true" aria-label="Loading settings">
      <div className="mb-6">
        <div className="h-7 w-28 rounded-lg bg-muted" />
        <div className="mt-2 h-4 w-80 rounded bg-muted" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)]">
        <div className="panel p-5">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="mt-5 space-y-5">
            <div className="space-y-2">
              <div className="h-3 w-36 rounded bg-muted" />
              <div className="h-10 rounded-lg bg-muted" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-48 rounded bg-muted" />
              <div className="h-10 rounded-lg bg-muted" />
            </div>
            <div className="h-10 rounded-lg bg-muted" />
          </div>
        </div>
        <div className="panel overflow-hidden">
          <div className="border-b border-border p-5">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(180px,0.7fr)_minmax(240px,1fr)_auto] md:items-end">
              <div className="h-10 rounded-lg bg-muted" />
              <div className="h-10 rounded-lg bg-muted" />
              <div className="h-10 w-20 rounded-lg bg-muted" />
            </div>
          </div>
          <div className="divide-y divide-border">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="space-y-1">
                  <div className="h-4 w-36 rounded bg-muted" />
                  <div className="h-3 w-52 rounded bg-muted" />
                </div>
                <div className="flex gap-2">
                  <div className="h-9 w-9 rounded-lg bg-muted" />
                  <div className="h-9 w-9 rounded-lg bg-muted" />
                  <div className="h-9 w-9 rounded-lg bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel mt-5 overflow-hidden">
        <div className="border-b border-border p-5">
          <div className="h-4 w-24 rounded bg-muted" />
        </div>
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-4 w-28 rounded bg-muted" />
              <div className="h-4 w-40 rounded bg-muted" />
              <div className="ml-auto h-4 w-28 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
