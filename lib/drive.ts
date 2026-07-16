import { google } from "googleapis";
import { existsSync, readFileSync } from "node:fs";

type DriveAuth = InstanceType<typeof google.auth.GoogleAuth>;
let cachedDriveAuth: DriveAuth | null | undefined;
export {
  googleDriveThumbnailUrl,
  normalizeGoogleDriveImageUrl,
  parseGoogleDriveUrl,
  resolveAdThumbnailUrl,
  type DrivePreview
} from "@/lib/drive-urls";

export async function getDriveMetadata(fileId: string) {
  const auth = createDriveAuth();
  if (!auth) return null;

  const drive = google.drive({ version: "v3", auth });
  const response = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,thumbnailLink,webViewLink,webContentLink"
  });

  return response.data;
}

export async function getDriveThumbnail(fileId: string) {
  const auth = createDriveAuth();
  if (!auth) return null;

  const drive = google.drive({ version: "v3", auth });
  const { data } = await drive.files.get({ fileId, fields: "thumbnailLink" });
  if (!data.thumbnailLink) return null;

  const accessToken = await auth.getAccessToken();
  const response = await fetch(data.thumbnailLink, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    cache: "no-store"
  });
  if (!response.ok) return null;

  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "image/jpeg"
  };
}

/** List the immediate children of a Drive folder. Returns [] if not a folder or on error. */
export async function getDriveFolderContents(folderId: string) {
  const auth = createDriveAuth();
  if (!auth) return [];
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,size)",
    pageSize: 100,
  });
  return res.data.files ?? [];
}

export async function getDriveMedia(fileId: string, range?: string | null) {
  const auth = createDriveAuth();
  if (!auth) return null;
  const accessToken = await auth.getAccessToken();
  if (!accessToken) return null;
  return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}`, ...(range ? { Range: range } : {}) },
    cache: "no-store"
  });
}

function createDriveAuth() {
  if (cachedDriveAuth !== undefined) return cachedDriveAuth;

  const serviceAccountJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    cachedDriveAuth = null;
    return cachedDriveAuth;
  }

  try {
    const credentialsSource = serviceAccountJson.trim().replace(/^"(.*)"$/, "$1");
    const credentials = JSON.parse(
      credentialsSource.startsWith("{") || !existsSync(credentialsSource)
        ? credentialsSource
        : readFileSync(credentialsSource, "utf8")
    );
    cachedDriveAuth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"]
    });
  } catch (err) {
    console.error(
      "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is set but could not be parsed as JSON or read as a file path. " +
        "It must contain the full service account key JSON (or a path that exists on this machine).",
      err
    );
    cachedDriveAuth = null;
  }
  return cachedDriveAuth;
}
