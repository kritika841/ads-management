import "server-only";

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { Zip, ZipPassThrough } from "fflate";
import { getDriveFolderContents, getDriveMedia, getDriveMetadata } from "@/lib/drive";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";
import type { ExportJobFile, ExportJobSnapshot } from "@/lib/export-job-types";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const JOB_LIFETIME_MS = 60 * 60 * 1000;
const EXPORT_DIR = path.join(tmpdir(), "adflow-export-jobs");

type InternalFile = ExportJobFile & { driveFileId: string; tempPath?: string };
type InternalJob = Omit<ExportJobSnapshot, "files"> & {
  ownerId: string;
  files: InternalFile[];
  outputPath: string;
  expiresAt: number;
};

type ExportJobStore = { jobs: Map<string, InternalJob> };
const globalStore = globalThis as typeof globalThis & { __adflowExportJobs?: ExportJobStore };
const store = globalStore.__adflowExportJobs ??= { jobs: new Map() };

export async function createExportJob(profile: Profile, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) throw new Error("Choose at least one creative.");

  await mkdir(EXPORT_DIR, { recursive: true });
  cleanupExpiredJobs();
  const id = randomUUID();
  const job: InternalJob = {
    id,
    ownerId: profile.id,
    phase: "preparing",
    requestedCount: uniqueIds.length,
    inspectedCount: 0,
    files: [],
    sourceTotalBytes: 0,
    sourceProcessedBytes: 0,
    zipSizeBytes: null,
    error: null,
    createdAt: new Date().toISOString(),
    outputPath: path.join(EXPORT_DIR, `${id}.zip`),
    expiresAt: Date.now() + JOB_LIFETIME_MS,
  };
  store.jobs.set(id, job);
  void prepareAndBuild(job, profile, uniqueIds);
  return snapshot(job);
}

export function getExportJob(id: string, ownerId: string) {
  cleanupExpiredJobs();
  const job = store.jobs.get(id);
  return job?.ownerId === ownerId ? job : null;
}

export function getExportJobSnapshot(id: string, ownerId: string) {
  const job = getExportJob(id, ownerId);
  return job ? snapshot(job) : null;
}

function snapshot(job: InternalJob): ExportJobSnapshot {
  return {
    id: job.id,
    phase: job.phase,
    requestedCount: job.requestedCount,
    inspectedCount: job.inspectedCount,
    files: job.files.map((file) => ({
      id: file.id,
      adId: file.adId,
      name: file.name,
      sizeBytes: file.sizeBytes,
      processedBytes: file.processedBytes,
      state: file.state,
      message: file.message,
    })),
    sourceTotalBytes: job.sourceTotalBytes,
    sourceProcessedBytes: job.sourceProcessedBytes,
    zipSizeBytes: job.zipSizeBytes,
    error: job.error,
    createdAt: job.createdAt,
  };
}

async function prepareAndBuild(job: InternalJob, profile: Profile, ids: string[]) {
  try {
    const ads = await loadAuthorizedAds(profile, ids);
    const names = new Set<string>();
    const authorizedIds = new Set(ads.map((ad) => ad.id));
    for (const missingId of ids.filter((id) => !authorizedIds.has(id))) {
      job.files.push({ id: randomUUID(), adId: missingId, driveFileId: "", name: `Unavailable creative ${missingId.slice(0, 8)}`, sizeBytes: 0, processedBytes: 0, state: "skipped", message: "The creative does not exist or you cannot download it." });
      job.inspectedCount += 1;
    }
    for (const ad of ads) {
      try {
        if (!ad.drive_file_id) throw new Error("No Google Drive file is attached.");
        const files = await listDriveFiles(ad.drive_file_id, ad.name);
        if (!files.length) throw new Error("No downloadable video was found in Google Drive.");
        for (const file of files) {
          job.files.push({
            id: randomUUID(),
            adId: ad.id,
            driveFileId: file.driveFileId,
            name: uniqueFilename(file.name, names),
            sizeBytes: file.sizeBytes,
            processedBytes: 0,
            state: "queued",
            message: null,
          });
          job.sourceTotalBytes += file.sizeBytes;
        }
      } catch (cause) {
        job.files.push({
          id: randomUUID(), adId: ad.id, driveFileId: "", name: ad.name, sizeBytes: 0, processedBytes: 0,
          state: "skipped", message: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        job.inspectedCount += 1;
      }
    }
    if (!job.files.some((file) => file.state === "queued")) throw new Error("None of the selected creatives could be downloaded.");
    job.phase = "building";
    await buildZip(job);
    const output = await stat(job.outputPath);
    job.zipSizeBytes = output.size;
    job.phase = "ready";
  } catch (cause) {
    job.phase = "failed";
    job.error = cause instanceof Error ? cause.message : String(cause);
    await unlink(job.outputPath).catch(() => undefined);
  }
}

async function loadAuthorizedAds(profile: Profile, ids: string[]) {
  const admin = createSupabaseAdminClient();
  const rows: { id: string; name: string; drive_file_id: string | null }[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    let query = admin.from("ads").select("id,name,drive_file_id").in("id", ids.slice(index, index + 100));
    if (profile.role === "editor") query = query.eq("editor_id", profile.id);
    else if (profile.role === "content_creator") query = query.eq("creator_id", profile.id);
    const { data, error } = await query;
    if (error) throw new Error(`Could not load selected creatives: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function listDriveFiles(driveFileId: string, adName: string) {
  const metadata = await getDriveMetadata(driveFileId);
  if (!metadata) {
    return [{ driveFileId, name: `${safeName(adName)}.mp4`, sizeBytes: await probePublicDriveSize(driveFileId) }];
  }
  if (metadata.mimeType !== FOLDER_MIME) {
    return [{ driveFileId, name: `${safeName(adName)}.${extensionFrom(metadata.name, metadata.mimeType)}`, sizeBytes: requiredSize(metadata.size) }];
  }
  const children = await getDriveFolderContents(driveFileId);
  return children
    .filter((child): child is typeof child & { id: string } => Boolean(child.id) && child.mimeType !== FOLDER_MIME)
    .map((child) => ({ driveFileId: child.id, name: `${safeName(adName)}_${safeName(child.name ?? child.id)}`, sizeBytes: requiredSize(child.size) }));
}

async function buildZip(job: InternalJob) {
  const output = createWriteStream(job.outputPath, { flags: "wx" });
  let zipError: Error | null = null;
  const zip = new Zip((error, chunk, final) => {
    if (error) { zipError = error; output.destroy(error); return; }
    if (chunk?.length) output.write(Buffer.from(chunk));
    if (final) output.end();
  });

  for (const file of job.files) {
    if (file.state !== "queued") continue;
    file.state = "downloading";
    try {
      file.tempPath = path.join(EXPORT_DIR, `${job.id}-${file.id}.source`);
      await downloadSourceFile(job, file);
      const entry = new ZipPassThrough(file.name);
      zip.add(entry);
      for await (const chunk of createReadStream(file.tempPath)) entry.push(new Uint8Array(chunk));
      entry.push(new Uint8Array(), true);
      file.state = "included";
    } catch (cause) {
      file.state = "failed";
      file.message = cause instanceof Error ? cause.message : String(cause);
      job.sourceProcessedBytes += Math.max(0, file.sizeBytes - file.processedBytes);
    } finally {
      if (file.tempPath) await unlink(file.tempPath).catch(() => undefined);
      file.tempPath = undefined;
    }
  }

  const reportLines = job.files.filter((file) => file.state === "skipped" || file.state === "failed");
  if (reportLines.length) {
    const report = new ZipPassThrough("DOWNLOAD_REPORT.txt");
    zip.add(report);
    report.push(new TextEncoder().encode(reportLines.map((file) => `- ${file.name}: ${file.message}`).join("\n")), true);
  }
  zip.end();
  await finished(output);
  if (zipError) throw zipError;
  if (!job.files.some((file) => file.state === "included")) throw new Error("Every Google Drive download failed.");
}

async function downloadSourceFile(job: InternalJob, file: InternalFile) {
  const response = await getExportMedia(file.driveFileId);
  if (!response?.ok || !response.body) throw new Error(`Google Drive returned ${response?.status ?? "no response"}.`);
  const output = createWriteStream(file.tempPath!, { flags: "wx" });
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!output.write(Buffer.from(value))) await once(output, "drain");
      file.processedBytes += value.byteLength;
      job.sourceProcessedBytes += value.byteLength;
    }
    output.end();
    await finished(output);
    if (file.processedBytes !== file.sizeBytes) throw new Error(`Expected ${file.sizeBytes} bytes but Google Drive returned ${file.processedBytes}.`);
  } catch (cause) {
    output.destroy();
    throw cause;
  } finally {
    reader.releaseLock();
  }
}

async function getExportMedia(fileId: string) {
  const authenticated = await getDriveMedia(fileId).catch(() => null);
  if (isDownloadResponse(authenticated)) return authenticated;
  const publicResponse = await fetch(publicDriveDownloadUrl(fileId), { cache: "no-store", signal: AbortSignal.timeout(30_000) }).catch(() => null);
  return isDownloadResponse(publicResponse) ? publicResponse : null;
}

async function probePublicDriveSize(fileId: string) {
  const response = await fetch(publicDriveDownloadUrl(fileId), {
    headers: { Range: "bytes=0-0" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !response.body || contentType.includes("text/html") || contentType.includes("application/json")) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Google Drive did not expose an exact size (HTTP ${response.status}).`);
  }
  const contentRange = response.headers.get("content-range");
  const rangeSize = contentRange?.match(/\/(\d+)$/)?.[1];
  const size = Number(rangeSize ?? response.headers.get("content-length"));
  await response.body?.cancel().catch(() => undefined);
  return requiredSize(size);
}

function isDownloadResponse(response: Response | null): response is Response {
  if (!response?.ok || !response.body) return false;
  const contentType = response.headers.get("content-type") ?? "";
  return !contentType.includes("text/html") && !contentType.includes("application/json");
}

function publicDriveDownloadUrl(fileId: string) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
}

function cleanupExpiredJobs() {
  for (const [id, job] of store.jobs) {
    if (job.expiresAt > Date.now()) continue;
    store.jobs.delete(id);
    void unlink(job.outputPath).catch(() => undefined);
  }
}

function requiredSize(value: string | number | null | undefined) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) throw new Error("The exact Google Drive file size is unavailable.");
  return size;
}
function safeName(value: string) { return value.replace(/[^a-zA-Z0-9._\- ]/g, "_"); }
function extensionFrom(name: string | null | undefined, mimeType: string | null | undefined) { return name?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || mimeType?.split("/")[1]?.toLowerCase() || "mp4"; }
function uniqueFilename(filename: string, names: Set<string>) { if (!names.has(filename)) { names.add(filename); return filename; } const match = filename.match(/^(.*?)(\.[^.]+)?$/); const stem = match?.[1] || filename; const extension = match?.[2] || ""; let index = 2; let candidate = `${stem} (${index})${extension}`; while (names.has(candidate)) candidate = `${stem} (${++index})${extension}`; names.add(candidate); return candidate; }
