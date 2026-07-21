"use client";

import { useState, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge } from "lucide-react";
import type { EditorTimelinePoint } from "@/lib/data";
import { formatDurationHours } from "@/lib/utils";
import type { Profile } from "@/lib/types";

export function EditorTimelineChart({ data, profiles }: { data: EditorTimelinePoint[]; profiles: { id: string; name: string }[] }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  
  const filteredData = useMemo(() => {
    return data.slice(-days);
  }, [data, days]);

  const colors = [
    "#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6366f1"
  ];

  return (
    <section className="panel mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-accent text-primary">
            <Gauge className="size-[18px]" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Editing time trend</h3>
            <p className="text-xs text-muted-foreground">Active editing hours per day</p>
          </div>
        </div>
        
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d as any)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${days === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"}`}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>
      
      <div className="h-72 p-4 pt-6">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filteredData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              {profiles.map((p, i) => (
                <linearGradient key={p.id} id={`fill-${p.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors[i % colors.length]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors[i % colors.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
            <XAxis 
              dataKey="date" 
              tickFormatter={(val) => {
                const date = new Date(val);
                return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
              }}
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: 'currentColor' }}
              className="text-muted-foreground"
              dy={10}
            />
            <YAxis 
              tickFormatter={(val) => `${Math.floor(val / 3600)}h`}
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 11, fill: 'currentColor' }}
              className="text-muted-foreground"
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border border-border bg-card p-3 shadow-float">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">{new Date(label).toLocaleDateString()}</p>
                      <div className="space-y-1.5">
                        {payload.map((entry, index) => {
                          const name = profiles.find(p => p.id === entry.dataKey)?.name ?? "Unknown";
                          return (
                            <div key={index} className="flex items-center justify-between gap-4 text-sm">
                              <div className="flex items-center gap-1.5">
                                <div className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span className="font-medium text-foreground">{name}</span>
                              </div>
                              <span className="font-mono text-muted-foreground">
                                {formatDurationHours((entry.value as number) / 3600)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            {profiles.map((p, i) => (
              <Area
                key={p.id}
                type="monotone"
                dataKey={p.id}
                stackId="1"
                stroke={colors[i % colors.length]}
                fill={`url(#fill-${p.id})`}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
