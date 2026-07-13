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
