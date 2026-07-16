export default function AdReviewLoading() {
  return (
    <main className="page-container animate-pulse" aria-busy="true" aria-label="Loading creative">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted" />
        <div className="h-6 w-52 rounded-lg bg-muted" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className="panel overflow-hidden">
            <div className="aspect-video bg-muted" />
          </div>
          <div className="panel p-5 space-y-3">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-20 rounded-lg bg-muted" />
          </div>
        </div>
        <div className="space-y-4">
          <div className="panel p-5 space-y-4">
            <div className="h-4 w-32 rounded bg-muted" />
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="flex justify-between">
                <div className="h-3 w-24 rounded bg-muted" />
                <div className="h-3 w-28 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="panel p-5 space-y-3">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="h-10 rounded-lg bg-muted" />
            <div className="h-10 rounded-lg bg-muted" />
          </div>
          <div className="panel p-5 space-y-3">
            <div className="h-4 w-20 rounded bg-muted" />
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex gap-3">
                <div className="size-8 rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 rounded bg-muted" />
                  <div className="h-10 rounded-lg bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
