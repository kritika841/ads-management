export type ExportJobFileState = "queued" | "downloading" | "included" | "skipped" | "failed";

export type ExportJobFile = {
  id: string;
  adId: string | null;
  name: string;
  sizeBytes: number;
  processedBytes: number;
  state: ExportJobFileState;
  message: string | null;
};

export type ExportJobSnapshot = {
  id: string;
  phase: "preparing" | "building" | "ready" | "failed";
  requestedCount: number;
  inspectedCount: number;
  files: ExportJobFile[];
  sourceTotalBytes: number;
  sourceProcessedBytes: number;
  zipSizeBytes: number | null;
  error: string | null;
  createdAt: string;
};
