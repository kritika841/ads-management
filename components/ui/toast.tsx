"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";

type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
  action?: { label: string; onClick: () => void };
  onExpire?: () => void | Promise<void>;
};

type ToastItem = ToastInput & { id: string };
type ToastContextValue = { toast: (input: ToastInput) => string; dismiss: (id: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const expiryCallbacks = useRef(new Map<string, ToastInput["onExpire"]>());

  const remove = useCallback((id: string, commit = true) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const onExpire = expiryCallbacks.current.get(id);
    expiryCallbacks.current.delete(id);
    if (commit && onExpire) void Promise.resolve(onExpire());
    setItems((current) => current.filter((candidate) => candidate.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = crypto.randomUUID();
    const item = { tone: "info" as const, duration: 4_000, ...input, id };
    setItems((current) => [...current, item]);
    expiryCallbacks.current.set(id, item.onExpire);
    timers.current.set(id, setTimeout(() => remove(id), item.duration));
    return id;
  }, [remove]);

  const value = useMemo(() => ({ toast, dismiss: (id: string) => remove(id) }), [remove, toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" aria-atomic="false">
        {items.map((item) => {
          const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? XCircle : Info;
          return (
            <section
              key={item.id}
              className={cn(
                "pointer-events-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-float dark:shadow-none",
                item.tone === "success" && "border-success/40",
                item.tone === "error" && "border-destructive/40",
                item.tone === "info" && "border-border"
              )}
              role={item.tone === "error" ? "alert" : "status"}
            >
              <div className="flex items-start gap-3">
                <Icon className={cn("mt-0.5 size-5 shrink-0", item.tone === "success" ? "text-success" : item.tone === "error" ? "text-destructive" : "text-primary")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  {item.description ? <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p> : null}
                  {item.action ? (
                    <button
                      type="button"
                      className="mt-2 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        remove(item.id, false);
                        item.action?.onClick();
                      }}
                    >
                      {item.action.label}
                    </button>
                  ) : null}
                </div>
                <button type="button" className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Dismiss notification" onClick={() => remove(item.id)}>
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
