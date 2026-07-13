export default function LibraryLoading() {
  return (
    <main className="page-container animate-pulse" aria-busy="true" aria-label="Loading creative library">
      <div className="flex items-center justify-between"><div><div className="h-7 w-44 rounded-lg bg-muted" /><div className="mt-2 h-4 w-72 max-w-[70vw] rounded bg-muted" /></div><div className="h-10 w-36 rounded-lg bg-muted" /></div>
      <div className="mt-6 h-11 w-[min(620px,100%)] rounded-lg bg-muted" />
      <div className="panel mt-4 h-16" />
      <div className="mt-7 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="overflow-hidden rounded-xl border border-border bg-card"><div className="aspect-video bg-muted" /><div className="space-y-3 p-4"><div className="h-5 w-2/3 rounded bg-muted" /><div className="h-4 w-1/2 rounded bg-muted" /><div className="h-10 rounded-lg bg-muted" /></div></div>)}
      </div>
    </main>
  );
}
