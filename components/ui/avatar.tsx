import { initials, cn } from "@/lib/utils";

export function Avatar({
  name,
  src,
  className
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cn("size-9 rounded-full object-cover ring-1 ring-border", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground ring-1 ring-primary/30",
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
