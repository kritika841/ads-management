import { ExternalLink, GitCommitHorizontal } from "lucide-react";
import type { AdVersion } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function VersionHistory({ versions }: { versions: AdVersion[] }) {
  const sortedVersions = [...versions].sort((a, b) => b.version_number - a.version_number);
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="section-heading">Version history</h2><p className="mt-1 text-xs text-slate-500">Every submitted revision is preserved.</p></div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">{versions.length}</span>
      </div>
      <div className="mt-5 divide-y divide-border border-y border-border">
        {sortedVersions.map((version) => (
          <div key={version.id} className="grid gap-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
            <span className="flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"><GitCommitHorizontal className="size-4" aria-hidden /></span>
            <div className="min-w-0"><p className="text-sm font-semibold text-slate-800">Version {version.version_number}</p><p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{version.script_text || "No script added"}</p></div>
            <span className="flex items-center gap-3 text-xs text-slate-500">
              {version.drive_url ? (
                <a
                  href={version.drive_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:text-teal-700"
                >
                  Drive <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
              {formatDateTime(version.created_at)}
            </span>
          </div>
        ))}
        {!versions.length ? <p className="py-8 text-center text-sm text-slate-500">No submitted versions yet.</p> : null}
      </div>
    </section>
  );
}
