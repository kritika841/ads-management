const fs = require("fs");
const os = require("os");
const path = require("path");
const { google } = require("googleapis");
const { GoogleGenAI } = require("@google/genai");
const { createClient } = require("@supabase/supabase-js");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;

const MODEL_NAME = "gemini-3.6-flash";
const DELAY_BETWEEN_CLIPS_MS = 4000;
const BATCH_SIZE = 50;

const TAGGING_PROMPT = `
You are tagging a RAW, AI-generated video clip for a searchable stock/asset
library. These clips are short single-scene building blocks that a video
editor will later browse, search, and cut together into finished ads for a
spiritual/wellness e-commerce brand (products include rudraksha malas,
incense, and related spiritual items).

Watch the full clip (visuals + audio) and return ONLY a JSON object
(no markdown fences, no preamble) with this exact shape:

{
  "description": "1-3 sentence, richly detailed description of exactly what is
    shown: subject, action, framing, and any product visible. Write it the
    way an editor would describe the shot to a colleague while searching for it.",
  "shot_type": "close-up product shot / lifestyle shot / unboxing / b-roll /
    hero shot / transition / macro detail / talking head / other",
  "camera_movement": "static / pan / tilt / zoom / dolly / handheld / orbit / other",
  "subject": "who or what is the main focus",
  "action": "what is physically happening",
  "products_shown": ["e.g. rudraksha mala", "incense stick", "gift box"],
  "setting": "indoor studio / home / outdoor / abstract background / other",
  "mood": "calm / devotional / festive / energetic / minimal / other",
  "color_palette": "brief description, e.g. 'warm earth tones'",
  "suggested_edit_use": "hook / b-roll / product-detail-insert / transition / CTA-shot / other",
  "has_text_overlay": true or false,
  "has_audio_or_voiceover": true or false,
  "duration_notes": "e.g. 'single continuous 4s take'"
}

Be specific and concrete. If unsure about a field, make your best guess rather
than leaving it blank.
`;

async function main() {
  for (const [name, val] of Object.entries({
    GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH,
  })) {
    if (!val) { console.error(`Missing required env var: ${name}`); process.exit(1); }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });

  console.log("Loading local embedding model...");
  const { pipeline } = await import("@xenova/transformers");
  const embed = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  async function getEmbedding(text) {
    const output = await embed(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }

  let processedAny = true;
  while (processedAny) {
    processedAny = false;
    const { data: rows, error } = await supabase
      .from("ads")
      .select("id, name, raw_footage_url, raw_clip_status")
      .not("raw_footage_url", "is", null)
      .or("raw_clip_status.is.null,raw_clip_status.eq.pending")
      .limit(BATCH_SIZE);

    if (error) { console.error("Error querying ads table:", error.message); process.exit(1); }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      processedAny = true;
      console.log(`\n--- ${row.name || row.id} ---`);
      let fileId = extractDriveFileId(row.raw_footage_url);
      let folderFileMeta = null;

      if (!fileId) {
        const folderId = extractDriveFolderId(row.raw_footage_url);
        if (folderId) {
          try {
            const found = await getFirstFileInFolder(drive, folderId);
            if (found) {
              fileId = found.id;
              folderFileMeta = { name: found.name, mimeType: found.mimeType, size: found.size };
            }
          } catch (err) {
            console.error("Could not list folder " + folderId + ": " + err.message);
          }
        }
      }
      if (!fileId) {
        console.error(`Could not parse Drive file ID from: ${row.raw_footage_url}`);
        await supabase.from("ads").update({
          raw_clip_status: "error",
          raw_clip_error_message: "Could not parse Drive file ID from URL",
        }).eq("id", row.id);
        continue;
      }

      await supabase.from("ads").update({ raw_clip_status: "processing" }).eq("id", row.id);

      let tempPath;
      try {
        const meta = folderFileMeta ? { data: folderFileMeta } : await drive.files.get({ fileId, fields: "name, mimeType, size" });
        const uploadFilename = getSafeUploadFilename(fileId, meta.data.mimeType);
        tempPath = await downloadToTemp(drive, fileId, uploadFilename, meta.data.size);
        console.log("Downloaded. Tagging with Gemini...");

        const tags = await tagWithGeminiWithRetry(ai, tempPath, meta.data.mimeType);
        console.log("Tagged:", tags.description);

        const embedding = await getEmbedding([
          tags.description,
          tags.shot_type ? `Shot type: ${tags.shot_type}.` : "",
          tags.subject ? `Subject: ${tags.subject}.` : "",
          tags.action ? `Action: ${tags.action}.` : "",
          tags.products_shown?.length ? `Products: ${tags.products_shown.join(", ")}.` : "",
          tags.mood ? `Mood: ${tags.mood}.` : "",
          tags.setting ? `Setting: ${tags.setting}.` : "",
        ].filter(Boolean).join(" "));

        await supabase.from("ads").update({
          raw_clip_status: "done",
          raw_footage_original_name: meta.data.name || null,
          raw_clip_description: tags.description,
          raw_clip_camera_movement: tags.camera_movement,
          raw_clip_shot_type: tags.shot_type,
          raw_clip_subject: tags.subject,
          raw_clip_action: tags.action,
          raw_clip_products_shown: tags.products_shown,
          raw_clip_setting: tags.setting,
          raw_clip_mood: tags.mood,
          raw_clip_color_palette: tags.color_palette,
          raw_clip_suggested_edit_use: tags.suggested_edit_use,
          raw_clip_has_text_overlay: tags.has_text_overlay,
          raw_clip_has_audio: tags.has_audio_or_voiceover,
          raw_clip_duration_notes: tags.duration_notes,
          raw_clip_embedding: embedding,
          raw_clip_tagged_at: new Date().toISOString(),
        }).eq("id", row.id);

        console.log("Saved.");
      } catch (err) {
        if (isRateLimitError(err)) {
          console.error("Rate limit / quota hit:", err.message);
          await supabase.from("ads").update({
            raw_clip_status: "pending", raw_clip_error_message: null,
          }).eq("id", row.id);
          if (isDailyQuotaError(err)) {
            console.error("\nDaily quota exhausted. Re-run this script later.");
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            process.exit(0);
          }
          await sleep(20000);
        } else {
          console.error("Error processing clip:", err.message);
          await supabase.from("ads").update({
            raw_clip_status: "error", raw_clip_error_message: err.message,
          }).eq("id", row.id);
        }
      } finally {
        if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
      }
      await sleep(DELAY_BETWEEN_CLIPS_MS);
    }
  }
  console.log("\nDone. No more pending rows.");
}

function extractDriveFileId(url) {
  if (!url) return null;
  const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/, /\/d\/([a-zA-Z0-9_-]+)/];
  for (const re of patterns) { const m = url.match(re); if (m) return m[1]; }
  return null;
}

function extractDriveFolderId(url) {
  if (!url) return null;
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function getFirstFileInFolder(drive, folderId) {
  const q = `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`;
  const res = await drive.files.list({
    q,
    fields: "files(id, name, mimeType, size)",
    pageSize: 1,
    orderBy: "createdTime",
  });
  const files = res.data.files || [];
  console.log(`Folder ${folderId}: query returned ${files.length} video file(s)`);
  return files[0] || null;
}

async function downloadToTemp(drive, fileId, filename, expectedSize) {
  const tempPath = path.join(os.tmpdir(), `${fileId}-${filename}`);
  const backoffs = [2000, 5000, 10000];

  for (let attempt = 1; attempt <= 3; attempt++) {
    await fs.promises.unlink(tempPath).catch(() => {});

    const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
    await new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(tempPath);
      const abort = (err) => {
        res.data.destroy?.();
        dest.destroy?.();
        reject(err);
      };

      dest.once("finish", resolve);
      dest.once("error", abort);
      res.data.once("error", abort);
      res.data.pipe(dest);
    });

    const stat = await fs.promises.stat(tempPath);
    const expected = Number(expectedSize);
    if (!Number.isFinite(expected) || stat.size === expected) {
      return tempPath;
    }

    await fs.promises.unlink(tempPath).catch(() => {});
    if (attempt < 3) {
      await sleep(backoffs[attempt - 1]);
      continue;
    }
    throw new Error("Download size mismatch after 3 retries");
  }

  throw new Error("Download size mismatch after 3 retries");
}

function getSafeUploadFilename(fileId, mimeType) {
  const extension = mimeType && mimeType.includes("quicktime") ? ".mov" : ".mp4";
  return `${fileId}${extension}`;
}

async function tagWithGeminiWithRetry(ai, tempPath, mimeType, attempt = 1) {
  try { return await tagWithGemini(ai, tempPath, mimeType); }
  catch (err) {
    if (isRateLimitError(err) && !isDailyQuotaError(err) && attempt < 3) {
      const backoffMs = attempt * 15000;
      console.log(`Backing off ${backoffMs / 1000}s, retrying...`);
      await sleep(backoffMs);
      return tagWithGeminiWithRetry(ai, tempPath, mimeType, attempt + 1);
    }
    throw err;
  }
}

async function tagWithGemini(ai, tempPath, mimeType) {
  let uploadedFile = await ai.files.upload({ file: tempPath, config: { mimeType: mimeType || "video/mp4" } });
  while (uploadedFile.state === "PROCESSING") {
    await sleep(3000);
    uploadedFile = await ai.files.get({ name: uploadedFile.name });
  }
  if (uploadedFile.state !== "ACTIVE") throw new Error(`Gemini processing failed: ${uploadedFile.state}`);

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [{ role: "user", parts: [
      { fileData: { fileUri: uploadedFile.uri, mimeType: uploadedFile.mimeType } },
      { text: TAGGING_PROMPT },
    ]}],
  });
  const rawText = response.text.trim();
  const cleaned = rawText.replace(/^```json/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

function isRateLimitError(err) {
  const msg = (err.message || "").toLowerCase();
  return msg.includes("429") || msg.includes("resource_exhausted") || msg.includes("quota");
}
function isDailyQuotaError(err) {
  const msg = (err.message || "").toLowerCase();
  return msg.includes("per day") || msg.includes("daily");
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
