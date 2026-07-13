"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  className
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      returnFocusRef.current?.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      className={cn("m-0 h-full max-h-none w-full max-w-none overflow-y-auto bg-transparent p-0 text-foreground backdrop:bg-neutral-950/45 backdrop:backdrop-blur-[2px]", className)}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {children}
    </dialog>
  );
}
