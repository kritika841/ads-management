"use client";

import { useState } from "react";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActivityLog } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function ActivityDrawer({ activity }: { activity: ActivityLog[] }) {
  const [open, setOpen] = useState(false);
  return <><Button size="sm" variant="secondary" onClick={() => setOpen(true)}><History className="size-4" aria-hidden />Activity</Button>{open ? <div className="fixed inset-0 z-[70] bg-slate-950/35" role="dialog" aria-modal="true" aria-labelledby="activity-title" onClick={() => setOpen(false)}><aside className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-float" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 id="activity-title" className="text-lg font-semibold text-slate-950">Activity history</h2><p className="mt-0.5 text-xs text-slate-500">{activity.length} recorded events</p></div><Button size="icon" variant="ghost" className="size-9" title="Close" onClick={() => setOpen(false)}><X className="size-5" aria-hidden /></Button></div><div className="flex-1 overflow-y-auto p-5">{activity.length ? <div className="space-y-0">{activity.map((item) => <div key={item.id} className="relative border-l border-slate-200 pb-5 pl-5 last:pb-0"><span className="absolute -left-1 top-1.5 size-2 rounded-full bg-primary" /><p className="text-sm font-medium capitalize text-slate-900">{item.action.replaceAll("_", " ")}</p><p className="mt-0.5 text-xs text-slate-500">{item.actor?.name ?? "System"} · {formatDateTime(item.created_at)}</p>{Object.keys(item.metadata ?? {}).length ? <dl className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{Object.entries(item.metadata).filter(([, value]) => value !== null && value !== "").slice(0, 5).map(([key, value]) => <div key={key} className="flex gap-2"><dt className="capitalize text-slate-400">{key.replaceAll("_", " ")}</dt><dd className="ml-auto max-w-[60%] truncate text-right">{String(value)}</dd></div>)}</dl> : null}</div>)}</div> : <p className="text-sm text-slate-500">No activity recorded yet.</p>}</div></aside></div> : null}</>;
}
