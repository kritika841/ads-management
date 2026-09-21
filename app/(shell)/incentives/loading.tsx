export default function IncentivesLoading() {
  return <main className="page-container animate-pulse"><div className="h-8 w-52 rounded bg-muted" /><div className="mt-6 grid gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 rounded-xl bg-muted" />)}</div><div className="mt-5 h-96 rounded-xl bg-muted" /></main>;
}

