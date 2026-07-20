export type DrivePreview = {
  fileId: string;
  previewUrl: string;
  embedUrl: string;
  thumbnailUrl: string;
};

export function googleDriveThumbnailUrl(fileId: string, size = 1200) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size}`;
}

export function normalizeGoogleDriveImageUrl(input: string) {
  return parseGoogleDriveUrl(input)?.thumbnailUrl ?? input;
}

export function resolveAdThumbnailUrl(
  thumbnailUrl?: string | null,
  driveFileId?: string | null,
  size = 1200
) {
  if (thumbnailUrl) {
    return normalizeGoogleDriveImageUrl(thumbnailUrl);
  }

  if (driveFileId) {
    return googleDriveThumbnailUrl(driveFileId, size);
  }

  return null;
}

export function parseGoogleDriveUrl(input: string): DrivePreview | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (!["drive.google.com", "docs.google.com"].includes(url.hostname)) {
    return null;
  }

  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  const folderMatch = url.pathname.match(/\/folders\/([^/]+)/);
  const openId = url.searchParams.get("id");
  const fileId = fileMatch?.[1] ?? folderMatch?.[1] ?? openId;

  if (!fileId) {
    return null;
  }

  return {
    fileId,
    previewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
    embedUrl: `https://drive.google.com/uc?export=view&id=${fileId}`,
    thumbnailUrl: googleDriveThumbnailUrl(fileId)
  };
}

/**
 * Strict parser: only accepts a Google Drive *single video file* link.
 * Rejects folder links (drive.google.com/drive/folders/...) and any non-Drive URL.
 * Returns the DrivePreview on success or null on failure.
 */
export function parseGoogleDriveVideoFileUrl(input: string): { result: DrivePreview; error: null } | { result: null; error: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { result: null, error: "Enter a valid URL." };
  }

  if (![ "drive.google.com", "docs.google.com" ].includes(url.hostname)) {
    return { result: null, error: "Only Google Drive video links are accepted. Paste the link to a single Drive video file (e.g. https://drive.google.com/file/d/…/view)." };
  }

  // Reject folder URLs explicitly
  if (url.pathname.includes("/folders/") || url.pathname.includes("/drive/")) {
    return { result: null, error: "Folder links are not allowed. Paste the direct link to a single Google Drive video file, not a folder." };
  }

  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  const openId = url.searchParams.get("id");
  const fileId = fileMatch?.[1] ?? openId;

  if (!fileId) {
    return { result: null, error: "Could not find a file ID in this URL. Paste the direct link to a single Google Drive video file (e.g. https://drive.google.com/file/d/…/view)." };
  }

  return {
    result: {
      fileId,
      previewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
      embedUrl: `https://drive.google.com/uc?export=view&id=${fileId}`,
      thumbnailUrl: googleDriveThumbnailUrl(fileId)
    },
    error: null
  };
}
