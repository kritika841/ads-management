import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-medium transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0",
        variant === "primary" &&
          "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        variant === "secondary" &&
          "border-border bg-card text-foreground shadow-sm hover:border-ring/40 hover:bg-muted",
        variant === "ghost" && "border-transparent bg-transparent text-muted-foreground hover:bg-muted",
        variant === "danger" &&
          "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "icon" && "size-10 p-0",
        className
      )}
      {...props}
    />
  );
}
