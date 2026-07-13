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
        "inline-flex size-9 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800 ring-1 ring-teal-200",
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
