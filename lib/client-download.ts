export type DownloadProgress = {
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  etaSeconds: number | null;
};

type WritableDownload = { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort?(reason?: unknown): Promise<void> };
export type DownloadDestination = { createWritable(): Promise<WritableDownload> };

export async function chooseDownloadDestination(filename: string): Promise<DownloadDestination | null> {
  const picker = (window as typeof window & { showSaveFilePicker?: (options: unknown) => Promise<DownloadDestination> }).showSaveFilePicker;
  if (!picker) return null;
  return picker({ suggestedName: filename, types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }] });
}

export async function downloadWithProgress(url: string, fallbackFilename: string, onProgress: (progress: DownloadProgress) => void, init?: RequestInit, destination?: DownloadDestination | null) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());

  const totalHeader = Number(response.headers.get("content-length") ?? response.headers.get("x-download-size"));
  const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  const startedAt = performance.now();
  let receivedBytes = 0;
  const chunks: ArrayBuffer[] = [];
  const writable = destination ? await destination.createWritable() : null;

  onProgress({ receivedBytes: 0, totalBytes, percent: totalBytes ? 0 : null, etaSeconds: null });
  if (!response.body) {
    const blob = await response.blob();
    receivedBytes = blob.size;
    onProgress({ receivedBytes, totalBytes: totalBytes ?? receivedBytes, percent: 100, etaSeconds: 0 });
    saveBlob(blob, responseFilename(response, fallbackFilename));
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (writable) await writable.write(value);
      else chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
      receivedBytes += value.byteLength;
      const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
      const bytesPerSecond = receivedBytes / elapsedSeconds;
      const remainingBytes = totalBytes ? Math.max(totalBytes - receivedBytes, 0) : null;
      onProgress({
        receivedBytes,
        totalBytes,
        percent: totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null,
        etaSeconds: remainingBytes !== null && bytesPerSecond > 0 ? Math.ceil(remainingBytes / bytesPerSecond) : null,
      });
    }
    if (writable) await writable.close();
  } catch (cause) {
    await writable?.abort?.(cause).catch(() => undefined);
    throw cause;
  } finally {
    reader.releaseLock();
  }
  const blob = writable ? null : new Blob(chunks, { type: response.headers.get("content-type") ?? "application/octet-stream" });
  onProgress({ receivedBytes, totalBytes: totalBytes ?? receivedBytes, percent: 100, etaSeconds: 0 });
  if (blob) saveBlob(blob, responseFilename(response, fallbackFilename));
}

export function downloadProgressLabel(progress: DownloadProgress) {
  const amount = progress.totalBytes
    ? `${formatBytes(progress.receivedBytes)} of ${formatBytes(progress.totalBytes)}`
    : formatBytes(progress.receivedBytes);
  return `${progress.percent === null ? "Downloading" : `${progress.percent}%`} · ${amount}`;
}

function responseFilename(response: Response, fallbackFilename: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  return disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackFilename;
}

function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
