"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DashboardToday } from "@/components/dashboard/dashboard-today";
import type { DashboardSummaryModel } from "@/lib/dashboard-summary";

export function HomeDashboard({ model }: { model: DashboardSummaryModel }) {
  return <main className="page-container"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-semibold text-slate-950">Home</h1><p className="mt-1 text-sm text-slate-500">A focused view of what needs attention today.</p></div><Link href="/library" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">Open creative library<ArrowRight className="size-4" aria-hidden /></Link></div><DashboardToday model={model} onSelectQueue={(queue) => { window.location.href = `/library?queue=${queue}`; }} /></main>;
}
