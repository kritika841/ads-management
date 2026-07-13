import { google } from "googleapis";
import { existsSync, readFileSync } from "node:fs";
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

function createDriveAuth() {
  const serviceAccountJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return null;
  }

  const credentialsSource = serviceAccountJson.trim();
  const credentials = JSON.parse(
    credentialsSource.startsWith("{") || !existsSync(credentialsSource)
      ? credentialsSource
      : readFileSync(credentialsSource, "utf8")
  );
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"]
  });
}
