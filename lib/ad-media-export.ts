import { getDriveMedia, getDriveMetadata, getDriveFolderContents } from "@/lib/drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export type AdMedia =
  | { kind: "file"; name: string; contentType: string; bytes: Uint8Array }
  | { kind: "folder"; files: Record<string, Uint8Array> };

/** Resolves a single ad's Drive file (or folder of files) into downloadable bytes,
 *  preferring the service account and falling back to Drive's public download URL. */
export async function resolveAdMedia(driveFileId: string, fallbackName: string): Promise<AdMedia | null> {
  try {
    const meta = await getDriveMetadata(driveFileId);

    if (meta?.mimeType === FOLDER_MIME) {
      const children = await getDriveFolderContents(driveFileId);
      const files: Record<string, Uint8Array> = {};
      for (const child of children) {
        if (!child.id || child.mimeType === FOLDER_MIME) continue;
        const safeName = (child.name ?? child.id).replace(/[^a-zA-Z0-9._\- ]/g, "_");
        const bytes = await fetchFileBytes(child.id);
        if (bytes) files[safeName] = bytes;
        else console.error(`Could not fetch Drive child ${child.id} (${safeName}) via service account or public fallback`);
      }
      return { kind: "folder", files };
    }

    if (meta) {
      const safeName = (meta.name ?? fallbackName).replace(/[^a-zA-Z0-9._\- ]/g, "_");
      const bytes = await fetchFileBytes(driveFileId);
      if (!bytes) return null;
      return { kind: "file", name: safeName, contentType: meta.mimeType ?? "application/octet-stream", bytes };
    }

    console.error(`getDriveMetadata returned null for file ${driveFileId} (drive auth unavailable or file inaccessible) — trying public fallback`);
  } catch (err) {
    console.error(`Drive metadata lookup threw for file ${driveFileId}`, err);
  }

  const bytes = await fetchPublicFallback(driveFileId);
  if (!bytes) return null;
  return { kind: "file", name: `${fallbackName.replace(/[^a-zA-Z0-9._\- ]/g, "_")}.mp4`, contentType: "video/mp4", bytes };
}

async function fetchFileBytes(fileId: string): Promise<Uint8Array | null> {
  try {
    const res = await getDriveMedia(fileId);
    if (res?.ok) return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error(`getDriveMedia failed for file ${fileId}`, err);
  }
  return fetchPublicFallback(fileId);
}

/** Google's public download endpoint returns a 200 HTML page (sign-in/permission notice)
 *  instead of a 404 when a file isn't publicly shared. Reject anything that isn't real media
 *  so we never hand back an HTML error page disguised as a video. */
async function fetchPublicFallback(fileId: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      console.error(`Drive public fallback for ${fileId} returned ${contentType}, not media — skipping (file is likely not shared publicly)`);
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error(`Drive public fallback fetch failed for ${fileId}`, err);
    return null;
  }
}
