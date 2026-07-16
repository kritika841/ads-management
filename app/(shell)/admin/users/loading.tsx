export default function UsersLoading() {
  return (
    <main className="page-container animate-pulse" aria-busy="true" aria-label="Loading people">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-24 rounded-lg bg-muted" />
          <div className="mt-2 h-4 w-64 rounded bg-muted" />
        </div>
        <div className="h-10 w-32 rounded-lg bg-muted" />
      </div>
      <div className="panel mt-6 overflow-hidden">
        <div className="border-b border-border p-3">
          <div className="h-10 w-full max-w-sm rounded-lg bg-muted" />
        </div>
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="flex items-center gap-4 px-4 py-3">
              <div className="size-9 rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="h-3 w-56 rounded bg-muted" />
              </div>
              <div className="h-6 w-20 rounded-full bg-muted" />
              <div className="flex gap-1">
                <div className="h-9 w-9 rounded-lg bg-muted" />
                <div className="h-9 w-9 rounded-lg bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
