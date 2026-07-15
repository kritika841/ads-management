export default function ProductsLoading() {
  return (
    <main className="page-container animate-pulse" aria-busy="true" aria-label="Loading products">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-28 rounded-lg bg-muted" />
          <div className="mt-2 h-4 w-64 rounded bg-muted" />
        </div>
        <div className="h-10 w-32 rounded-lg bg-muted" />
      </div>
      <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        {[0, 1].map((item) => (
          <div key={item} className="bg-card px-4 py-4">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="mt-2 h-7 w-12 rounded-lg bg-muted" />
          </div>
        ))}
      </div>
      <div className="panel mt-4 overflow-hidden">
        <div className="border-b border-border p-3">
          <div className="h-10 w-full max-w-sm rounded-lg bg-muted" />
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="flex items-center gap-3 bg-card p-4">
              <div className="size-14 rounded-md bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-28 rounded bg-muted" />
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-3 w-12 rounded-full bg-muted" />
              </div>
              <div className="flex gap-1">
                <div className="h-9 w-9 rounded-lg bg-muted" />
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
