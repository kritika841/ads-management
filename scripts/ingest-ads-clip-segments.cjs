const fs = require("fs");
const os = require("os");
const path = require("path");
const { google } = require("googleapis");
const { GoogleGenAI } = require("@google/genai");
const { createClient } = require("@supabase/supabase-js");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
const GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH;

const MODEL_NAME = "gemini-3.6-flash";
const BATCH_SIZE = 50;
const DELAY_BETWEEN_CLIPS_MS = 4000;
const QUOTA_EXIT_CODE = 75;
const TRANSIENT_ERROR_BACKOFF_MS = 20_000;

const TAGGING_PROMPT = `
You are tagging a RAW, AI-generated video clip for a searchable stock/asset
library used by video editors and by a natural-language search bar. The
quality of your description directly determines whether a person searching
in plain English will find this exact clip - be exhaustive, not brief.

Segment the video second-by-second. Every entry must cover exactly ONE
second (e.g. 0-1, 1-2, 2-3) - never merge multiple seconds into one range,
even if nothing changes between them. If a second is visually identical to
the one before it, still write a full description for it, don't shorten it
or refer back to the previous entry.

For each second, describe FOUR separate things, always all four even if
some don't change from the previous second:

1. SUBJECT/ACTION: the main action or focal subject in this exact second,
   broken into sub-steps if multiple things happen within the same second
   (e.g. "a hand enters frame from the right, grips the container, and
   begins lifting it" rather than just "hand holds container").

2. ON-SCREEN TEXT: any text visible on screen - product labels, packaging
   text, captions, brand names - transcribed as close to verbatim as
   legible, including Hindi/Devanagari script if present. Include this
   every second the text remains visible, not just when it first appears.
   Empty string if no text is visible in this second.

3. ENVIRONMENT/BACKGROUND: the full setting - lighting quality, colors,
   surface/table, and EVERY visible background prop or object, even minor
   ones (e.g. "a ceramic pot with green foliage to the right, a small bowl
   of spices to the lower left, a patterned notebook with a ribbon marker
   to the lower right"). Describe this fully every second, not just once
   when the scene is established - if the background is unchanged from the
   prior second, still write it out in full rather than omitting it.

4. PEOPLE: approximate appearance of anyone visible (clothing color/style,
   visible actions, position in frame), without identifying real
   individuals by name. Empty string if no person is visible.

Also note physical product details wherever relevant: shape, color,
material, size, distinguishing design elements, and any notable printed
symbols or motifs (e.g. "a subtle sacred symbol printed on the inner lid").

Return ONLY a JSON array, one entry per second, in this exact shape:

{
  "start_seconds": number,
  "end_seconds": number,
  "visual_description": "combined SUBJECT/ACTION and product-detail description for this second - itemized and thorough, not a single brief sentence",
  "environment_description": "full background/setting description for this second, per the ENVIRONMENT/BACKGROUND guidance above - repeat in full each second even if unchanged",
  "on_screen_text": "verbatim transcription of any visible text/labels/captions in this second, or empty string if none",
  "people_description": "appearance and actions of any visible person, or empty string if none",
  "spoken_text": "verbatim transcription of speech in this second, or empty string if none"
}

Do not summarize or simplify, and do not merge seconds together. A future
search must be able to match this description against specific product
names, label text, background props, and precise actions - treat this like
writing a detailed accessibility audio-description track for every single
second, not a casual caption for the clip as a whole.
`;

const SEGMENT_RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
      visual_description: { type: "string" },
      environment_description: { type: "string" },
      on_screen_text: { type: "string" },
      people_description: { type: "string" },
      spoken_text: { type: "string" },
    },
    required: ["start_seconds", "end_seconds", "visual_description", "environment_description", "on_screen_text", "people_description", "spoken_text"],
  },
};

class DailyQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = "DailyQuotaError";
  }
}

async function main() {
  const resolveUrlsOnly = process.argv.includes("--resolve-urls-only");
  const backfillCaptionsOnly = process.argv.includes("--backfill-captions-only");
  const repairStatesOnly = process.argv.includes("--repair-states");
  const includeDone = process.argv.includes("--reprocess-done");
  const clipArgIndex = process.argv.indexOf("--clip");
  const targetClipName = clipArgIndex !== -1 ? process.argv[clipArgIndex + 1] : null;

  for (const [name, val] of Object.entries({
    GEMINI_API_KEY,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_DRIVE_SERVICE_ACCOUNT_CREDENTIALS:
      GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH,
  })) {
    if (!val && name !== "GEMINI_API_KEY") {
      console.error(`Missing required env var: ${name}`);
      process.exit(1);
    }
  }

  if (!resolveUrlsOnly && !backfillCaptionsOnly && !GEMINI_API_KEY) {
    console.error("Missing required env var: GEMINI_API_KEY or GEMINI_API_KEYS");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const auth = createDriveAuth();
  const drive = google.drive({ version: "v3", auth });

  const repairSummary = await repairSegmentIngestState(supabase);
  if (repairSummary.reconciledDone > 0 || repairSummary.requeuedTransient > 0) {
    console.log(
      `Repaired state. Reconciled done: ${repairSummary.reconciledDone}, re-queued transient errors: ${repairSummary.requeuedTransient}.`
    );
  }

  if (resolveUrlsOnly) {
    console.log("Resolve-only mode enabled: backfilling resolved_video_url and thumbnail_url without Gemini tagging.");
    await processResolveOnlyBackfill(supabase, drive);
    return;
  }

  if (backfillCaptionsOnly) {
    console.log("Caption backfill mode enabled: deriving raw_clip_description from the first segment only.");
    await processCaptionBackfill(supabase);
    return;
  }

  if (repairStatesOnly) {
    console.log("Repair-only mode enabled. Exiting after state reconciliation.");
    return;
  }

  const { embedWithGemini, getCurrentGeminiApiKey, rotateGeminiApiKey } = await import("../lib/raw-clips.js");
  
  let ai = new GoogleGenAI({ apiKey: getCurrentGeminiApiKey() });

  await syncRawClipsCatalog(supabase, drive, { targetClipName });

  const { data: resetCount, error: resetError } = await supabase.rpc("reset_stale_segment_ingest", {
    stale_minutes: 15,
  });
  if (resetError) {
    console.error("Failed to reset stale segment ingest rows:", resetError.message);
    process.exit(1);
  }
  console.log(`Reset ${resetCount || 0} stale segment ingest row(s).`);


  console.log("Ready to embed with Gemini...");

  if (includeDone) {
    console.log("Backfill mode enabled: already-done clips will be reprocessed once.");
  }

  let processedAny = true;
  while (processedAny) {
    processedAny = false;
    let query = supabase
      .from("raw_clips")
      .select("id, ad_id, drive_file_id, source_raw_footage_url, resolved_video_url, thumbnail_url, original_name, duration_millis, created_at, ingest_status, ads:ad_id(name)")
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (targetClipName) {
      query = query.eq("ads.name", targetClipName);
    } else if (includeDone) {
      query = query.in("ingest_status", ["pending", "done"]);
    } else {
      query = query.eq("ingest_status", "pending");
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error("Error querying raw_clips table:", error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const clipName = Array.isArray(row.ads) ? row.ads[0]?.name || row.id : row.ads?.name || row.id;
      const claimed = await claimRawClipForProcessing(supabase, row.id, {
        force: Boolean(targetClipName),
        includeDone,
      });
      if (!claimed) {
        console.log(`\n--- ${clipName} / ${row.drive_file_id || row.id} ---`);
        console.log("Skipped: another worker already claimed this clip.");
        continue;
      }

      processedAny = true;
      console.log(`\n--- ${clipName} / ${row.drive_file_id || row.id} ---`);

      let tempPath;
      try {
        const { fileId, meta, resolvedVideoUrl, thumbnailUrl } = await resolveDriveFileMeta(
          drive,
          row.source_raw_footage_url,
          row.drive_file_id
        );
        if (!fileId) {
          throw new Error("Could not parse Drive file or folder ID from URL");
        }

        const safeName = getSafeUploadFilename(fileId, meta.mimeType);
        tempPath = await downloadToTemp(drive, fileId, safeName, meta.size);
        const durationMillis = Number(meta.durationMillis || 0);
        if (durationMillis > 120000) {
          console.warn(`[LONG] ${row.id} is ${(durationMillis / 1000).toFixed(1)}s; segment output may be large.`);
        }

        console.log("Downloaded. Tagging with Gemini...");
        const segments = await tagWithGeminiWithRetry(
          ai,
          tempPath,
          meta.mimeType,
          TAGGING_PROMPT,
          SEGMENT_RESPONSE_SCHEMA,
          rotateGeminiApiKey,
          getCurrentGeminiApiKey
        );
        // If the ai instance changed, update it so subsequent clips use the current key
        ai = new GoogleGenAI({ apiKey: getCurrentGeminiApiKey() });
        
        if (!Array.isArray(segments)) {
          throw new Error("Gemini response was not a JSON array");
        }

        const normalizedSegments = segments.map((segment, index) => normalizeSegment(segment, index));
        const segmentRows = [];

        // Unconditionally delete old segments to make insertion idempotent
        const { error: deleteError } = await supabase.from("raw_clip_segments").delete().eq("raw_clip_id", row.id);
        if (deleteError) {
          throw new Error(`Failed to clear old segments: ${deleteError.message}`);
        }

        for (const segment of normalizedSegments) {
          const embedInput = buildSegmentEmbedInput(
            segment.visual_description,
            segment.spoken_text,
            segment.environment_description,
            segment.on_screen_text,
            segment.people_description
          );
          const embedding = await embedWithGemini(embedInput);
          if (embedding.length !== 3072) {
            throw new Error(`Expected 3072-dimensional segment embedding, got ${embedding.length}`);
          }

          segmentRows.push({
            raw_clip_id: row.id,
            ad_id: row.ad_id,
            segment_index: segment.segment_index,
            start_seconds: segment.start_seconds,
            end_seconds: segment.end_seconds,
            visual_description: segment.visual_description,
            environment_description: segment.environment_description,
            on_screen_text: segment.on_screen_text,
            people_description: segment.people_description,
            spoken_text: segment.spoken_text,
            embedding_gemini: embedding,
          });
        }

        if (segmentRows.length > 0) {
          const { error: insertError } = await supabase.from("raw_clip_segments").insert(segmentRows);
          if (insertError) {
            throw new Error(`Failed to insert clip segments: ${insertError.message}`);
          }
        }

        const clipCaption = deriveClipCaptionFromSegments(normalizedSegments);

        await supabase
          .from("raw_clips")
          .update({
            ingest_status: "done",
            ingest_error: null,
            original_name: meta.originalName || null,
            resolved_video_url: resolvedVideoUrl || row.source_raw_footage_url,
            thumbnail_url: thumbnailUrl || row.thumbnail_url || null,
            preview_description: clipCaption,
            duration_millis: Number(meta.durationMillis || 0) || row.duration_millis || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        await syncAdIngestStatus(supabase, row.ad_id, {
          driveFileId: fileId,
          resolvedVideoUrl: resolvedVideoUrl || row.source_raw_footage_url,
          thumbnailUrl: thumbnailUrl || row.thumbnail_url || null,
          originalName: meta.originalName || null,
          clipCaption,
        });

        console.log(`Saved ${segmentRows.length} segment(s).`);
      } catch (err) {
        if (err instanceof DailyQuotaError || isDailyQuotaError(err)) {
          console.error("[QUOTA] Daily limit reached, exiting cleanly, will resume next scheduled run");
          await supabase
            .from("raw_clips")
            .update({
              ingest_status: "pending",
              ingest_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          await syncAdIngestStatus(supabase, row.ad_id);
          throw new DailyQuotaError(err.message || "Daily quota exhausted");
        }

        if (isRetryableProcessingError(err)) {
          console.error("Transient processing error, returning clip to pending:", err.message);
          await supabase
            .from("raw_clips")
            .update({
              ingest_status: "pending",
              ingest_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          await syncAdIngestStatus(supabase, row.ad_id);
          await sleep(TRANSIENT_ERROR_BACKOFF_MS);
          continue;
        }

        console.error("Error processing clip:", err.message);
        await supabase
          .from("raw_clips")
          .update({
            ingest_status: "error",
            ingest_error: err.message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        await syncAdIngestStatus(supabase, row.ad_id);
      } finally {
        if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
      }

      await sleep(DELAY_BETWEEN_CLIPS_MS);
    }
    if (targetClipName) {
      break;
    }
  }

  console.log("\nDone. No more pending segment rows.");
}

async function claimRawClipForProcessing(supabase, rawClipId, options = {}) {
  const { force = false, includeDone = false } = options;

  let query = supabase
    .from("raw_clips")
    .update({ ingest_status: "processing", ingest_error: null, updated_at: new Date().toISOString() })
    .eq("id", rawClipId)
    .select("id")
    .limit(1);

  if (!force) {
    query = includeDone
      ? query.in("ingest_status", ["pending", "done"])
      : query.eq("ingest_status", "pending");
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to claim raw clip for processing: ${error.message}`);
  }

  return Array.isArray(data) && data.length > 0;
}

async function syncRawClipsCatalog(supabase, drive, options = {}) {
  const { targetClipName = null } = options;
  let query = supabase
    .from("ads")
    .select("id, name, raw_footage_url, created_at")
    .not("raw_footage_url", "is", null)
    .order("created_at", { ascending: true })
    .limit(1000);

  if (targetClipName) {
    query = query.eq("name", targetClipName);
  }

  const { data: ads, error } = await query;
  if (error) {
    throw new Error(`Failed to load ads for raw clip sync: ${error.message}`);
  }

  for (const ad of ads || []) {
    const clips = await resolveDriveTargets(drive, ad.raw_footage_url);
    for (const clip of clips) {
      const { error: upsertError } = await supabase
        .from("raw_clips")
        .upsert({
          ad_id: ad.id,
          drive_file_id: clip.fileId,
          source_raw_footage_url: ad.raw_footage_url,
          resolved_video_url: clip.resolvedVideoUrl,
          thumbnail_url: clip.thumbnailUrl || null,
          original_name: clip.meta.originalName || null,
          duration_millis: Number(clip.meta.durationMillis || 0) || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "drive_file_id" });

      if (upsertError) {
        throw new Error(`Failed to upsert raw clip ${clip.fileId}: ${upsertError.message}`);
      }
    }
  }
}

async function syncAdIngestStatus(supabase, adId, metadata = null) {
  const { data: rawClips, error } = await supabase
    .from("raw_clips")
    .select("ingest_status, ingest_error, resolved_video_url, thumbnail_url, original_name, preview_description, drive_file_id")
    .eq("ad_id", adId);

  if (error) {
    throw new Error(`Failed to load raw clips for ad status sync: ${error.message}`);
  }

  const clips = rawClips || [];
  if (clips.length === 0) {
    return;
  }

  const statuses = clips.map((clip) => clip.ingest_status);
  let nextStatus = "pending";
  let nextError = null;

  if (statuses.every((status) => status === "done")) {
    nextStatus = "done";
  } else if (statuses.some((status) => status === "processing")) {
    nextStatus = "processing";
  } else if (statuses.some((status) => status === "pending")) {
    nextStatus = "pending";
  } else if (statuses.some((status) => status === "error")) {
    nextStatus = "error";
    nextError = clips.find((clip) => clip.ingest_error)?.ingest_error || null;
  }

  const representativeClip =
    clips.find((clip) => clip.ingest_status === "done") ||
    clips.find((clip) => clip.ingest_status === "processing") ||
    clips[0];

  const payload = {
    segment_ingest_status: nextStatus,
    segment_ingest_error: nextError,
    drive_file_id: metadata?.driveFileId || representativeClip?.drive_file_id || null,
    resolved_video_url: metadata?.resolvedVideoUrl || representativeClip?.resolved_video_url || null,
    thumbnail_url: metadata?.thumbnailUrl || representativeClip?.thumbnail_url || null,
    raw_footage_original_name: metadata?.originalName || representativeClip?.original_name || null,
    raw_clip_description: metadata?.clipCaption || representativeClip?.preview_description || null,
  };

  const { error: updateError } = await supabase
    .from("ads")
    .update(payload)
    .eq("id", adId);

  if (updateError) {
    throw new Error(`Failed to update ad ingest status: ${updateError.message}`);
  }
}

function createDriveAuth() {
  const credentials = parseDriveCredentials();
  if (credentials) {
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
  }

  if (GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH) {
    return new google.auth.GoogleAuth({
      keyFile: GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
  }

  throw new Error(
    "Missing Google Drive credentials. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH."
  );
}

function parseDriveCredentials() {
  if (!GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) return null;

  try {
    const source = GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.trim().replace(/^"(.*)"$/, "$1");
    const payload =
      source.startsWith("{") || !fs.existsSync(source)
        ? source
        : fs.readFileSync(source, "utf8");
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON could not be parsed as JSON or read as a file path: ${error.message}`
    );
  }
}

async function processCaptionBackfill(supabase) {
  const pageSize = 100;
  let from = 0;
  let updatedCount = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from("ads")
      .select("id, name")
      .eq("segment_ingest_status", "done")
      .not("raw_footage_url", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("Error querying done clips for caption backfill:", error.message);
      process.exit(1);
    }

    if (!rows || rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const { data: segments, error: segmentError } = await supabase
        .from("raw_clip_segments")
        .select("segment_index, visual_description")
        .eq("ad_id", row.id)
        .order("segment_index", { ascending: true })
        .limit(1);

      if (segmentError) {
        console.error(`Failed to load segments for ${row.name || row.id}:`, segmentError.message);
        continue;
      }

      const firstSegmentCaption = deriveClipCaptionFromSegments(segments || []);
      if (!firstSegmentCaption) {
        console.log(`Skipping ${row.name || row.id}: no segment caption available.`);
        continue;
      }

      const { error: updateError } = await supabase
        .from("ads")
        .update({ raw_clip_description: firstSegmentCaption })
        .eq("id", row.id);

      if (updateError) {
        console.error(`Failed to update caption for ${row.name || row.id}:`, updateError.message);
        continue;
      }

      updatedCount += 1;
      console.log(`Updated caption for ${row.name || row.id}`);
    }

    from += rows.length;
  }

  console.log(`\nCaption backfill finished. Updated ${updatedCount} clip(s).`);
}

async function processResolveOnlyBackfill(supabase, drive) {
  const failures = [];
  const { data: rows, error } = await supabase
    .from("ads")
    .select("id, name, raw_footage_url, resolved_video_url, thumbnail_url, created_at")
    .not("raw_footage_url", "is", null)
    .or("resolved_video_url.is.null,thumbnail_url.is.null")
    .order("created_at", { ascending: true })
    .range(0, 1000);

  if (error) {
    console.error("Error querying ads table:", error.message);
    process.exit(1);
  }

  const rowsToProcess = rows || [];
  for (const row of rowsToProcess) {
    console.log(`\n--- ${row.name || row.id} ---`);

    try {
      const { fileId, resolvedVideoUrl, thumbnailUrl, meta } = await resolveDriveFileMeta(drive, row.raw_footage_url);
      if (!fileId) {
        const reason = "Could not resolve a Drive video file from the folder or URL.";
        failures.push({ id: row.id, name: row.name || row.id, reason });
        console.error(reason);
        continue;
      }

      const { error: updateError } = await supabase
        .from("ads")
        .update({
          resolved_video_url: resolvedVideoUrl || row.raw_footage_url,
          thumbnail_url: thumbnailUrl || row.thumbnail_url || null,
          raw_footage_original_name: meta.originalName || null,
        })
        .eq("id", row.id);

      if (updateError) {
        failures.push({ id: row.id, name: row.name || row.id, reason: updateError.message });
        console.error("Failed to update clip metadata:", updateError.message);
        continue;
      }

      console.log("Updated resolved_video_url and thumbnail_url.");
    } catch (err) {
      const message = err.message || String(err);
      failures.push({ id: row.id, name: row.name || row.id, reason: message });
      console.error("Error resolving clip metadata:", message);
    }
  }

  console.log(`\nResolve-only pass finished. Processed ${rowsToProcess.length} clip(s).`);
  if (failures.length > 0) {
    console.error("\nUnresolved rows:");
    for (const failure of failures) {
      console.error(`- ${failure.name} (${failure.id}): ${failure.reason}`);
    }
    process.exit(1);
  }

  console.log("All eligible rows now have resolved_video_url and thumbnail_url.");
}

async function repairSegmentIngestState(supabase) {
  let reconciledDone = 0;
  let requeuedTransient = 0;

  const { data: rawClipRows, error: rawClipRowsError } = await supabase
    .from("raw_clips")
    .select("id, ad_id, ingest_status, ingest_error, preview_description");

  if (rawClipRowsError && !String(rawClipRowsError.message || "").includes("relation \"public.raw_clips\" does not exist")) {
    throw new Error(`Failed to load raw clips for repair: ${rawClipRowsError.message}`);
  }

  const { data: segmentRows, error: segmentError } = await supabase
    .from("raw_clip_segments")
    .select("ad_id, raw_clip_id, segment_index, visual_description")
    .order("raw_clip_id", { ascending: true })
    .order("segment_index", { ascending: true });

  if (segmentError) {
    throw new Error(`Failed to load raw clip segments for repair: ${segmentError.message}`);
  }

  const firstSegmentByAdId = new Map();
  const firstSegmentByRawClipId = new Map();
  for (const segment of segmentRows || []) {
    if (!firstSegmentByAdId.has(segment.ad_id) && String(segment.visual_description || "").trim()) {
      firstSegmentByAdId.set(segment.ad_id, String(segment.visual_description).trim());
    }
    if (segment.raw_clip_id && !firstSegmentByRawClipId.has(segment.raw_clip_id) && String(segment.visual_description || "").trim()) {
      firstSegmentByRawClipId.set(segment.raw_clip_id, String(segment.visual_description).trim());
    }
  }

  for (const rawClip of rawClipRows || []) {
    const previewDescription = firstSegmentByRawClipId.get(rawClip.id);
    if (!previewDescription) {
      continue;
    }

    if (rawClip.ingest_status !== "done" || !rawClip.preview_description) {
      const { error: rawClipUpdateError } = await supabase
        .from("raw_clips")
        .update({
          ingest_status: "done",
          ingest_error: null,
          preview_description: rawClip.preview_description || previewDescription,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rawClip.id);

      if (rawClipUpdateError) {
        throw new Error(`Failed to reconcile raw clip ${rawClip.id}: ${rawClipUpdateError.message}`);
      }
    }
  }

  const segmentAdIds = Array.from(firstSegmentByAdId.keys());
  if (segmentAdIds.length > 0) {
    for (const adId of segmentAdIds) {
      const { data: adRows, error: adError } = await supabase
        .from("ads")
        .select("id, segment_ingest_status, raw_clip_description")
        .eq("id", adId)
        .limit(1);

      if (adError) {
        throw new Error(`Failed to load ad ${adId} during repair: ${adError.message}`);
      }

      const ad = adRows?.[0];
      if (!ad || ad.segment_ingest_status === "done") {
        continue;
      }

      const { error: updateError } = await supabase
        .from("ads")
        .update({
          segment_ingest_status: "done",
          segment_ingest_error: null,
          raw_clip_description: ad.raw_clip_description || firstSegmentByAdId.get(adId) || null,
        })
        .eq("id", adId);

      if (updateError) {
        throw new Error(`Failed to reconcile ad ${adId} to done: ${updateError.message}`);
      }

      reconciledDone += 1;
    }
  }

  const { data: errorRows, error: errorRowsError } = await supabase
    .from("ads")
    .select("id, segment_ingest_error")
    .eq("segment_ingest_status", "error")
    .not("raw_footage_url", "is", null)
    .limit(1000);

  if (errorRowsError) {
    throw new Error(`Failed to load errored ads for repair: ${errorRowsError.message}`);
  }

  for (const row of errorRows || []) {
    if (!isRetryableErrorMessage(row.segment_ingest_error)) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("ads")
      .update({ segment_ingest_status: "pending", segment_ingest_error: null })
      .eq("id", row.id);

    if (updateError) {
      throw new Error(`Failed to re-queue transient error row ${row.id}: ${updateError.message}`);
    }

    requeuedTransient += 1;
  }

  return { reconciledDone, requeuedTransient };
}

async function resolveDriveFileMeta(drive, rawFootageUrl, preferredFileId = null) {
  const fileId = preferredFileId || extractDriveFileId(rawFootageUrl);
  if (fileId) {
    const meta = await drive.files.get({
      fileId,
      fields: "name, mimeType, size, videoMediaMetadata(durationMillis), thumbnailLink",
    });
    return {
      fileId,
      resolvedVideoUrl: `https://drive.google.com/file/d/${fileId}/view`,
      thumbnailUrl: meta.data.thumbnailLink || null,
      meta: {
        originalName: meta.data.name,
        mimeType: meta.data.mimeType,
        size: meta.data.size,
        durationMillis: meta.data.videoMediaMetadata?.durationMillis,
      },
    };
  }

  const folderId = extractDriveFolderId(rawFootageUrl);
  if (!folderId) {
    return { fileId: null, meta: {} };
  }

  const found = await getFirstFileInFolder(drive, folderId);
  if (!found) {
    return { fileId: null, meta: {} };
  }

  return {
    fileId: found.id,
    resolvedVideoUrl: `https://drive.google.com/file/d/${found.id}/view`,
    thumbnailUrl: found.thumbnailLink || null,
    meta: {
      originalName: found.name,
      mimeType: found.mimeType,
      size: found.size,
      durationMillis: found.videoMediaMetadata?.durationMillis,
    },
  };
}

async function resolveDriveTargets(drive, rawFootageUrl) {
  const directFileId = extractDriveFileId(rawFootageUrl);
  if (directFileId) {
    const clip = await resolveDriveFileMeta(drive, rawFootageUrl, directFileId);
    return clip.fileId ? [clip] : [];
  }

  const folderId = extractDriveFolderId(rawFootageUrl);
  if (!folderId) {
    return [];
  }

  const files = await listVideoFilesInFolder(drive, folderId);
  return files.map((file) => ({
    fileId: file.id,
    resolvedVideoUrl: `https://drive.google.com/file/d/${file.id}/view`,
    thumbnailUrl: file.thumbnailLink || null,
    meta: {
      originalName: file.name,
      mimeType: file.mimeType,
      size: file.size,
      durationMillis: file.videoMediaMetadata?.durationMillis,
    },
  }));
}

function extractDriveFileId(url) {
  if (!url) return null;
  const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/, /\/d\/([a-zA-Z0-9_-]+)/];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractDriveFolderId(url) {
  if (!url) return null;
  const m = url.match(/(?:\/drive)?\/folders\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]folder=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function getFirstFileInFolder(drive, folderId) {
  const q = `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`;
  const res = await drive.files.list({
    q,
    fields: "files(id, name, mimeType, size, videoMediaMetadata(durationMillis), thumbnailLink)",
    pageSize: 1,
    orderBy: "createdTime",
  });
  const files = res.data.files || [];
  console.log(`Folder ${folderId}: query returned ${files.length} video file(s)`);
  return files[0] || null;
}

async function listVideoFilesInFolder(drive, folderId) {
  const q = `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`;
  const res = await drive.files.list({
    q,
    fields: "files(id, name, mimeType, size, videoMediaMetadata(durationMillis), thumbnailLink)",
    pageSize: 1000,
    orderBy: "createdTime",
  });
  return res.data.files || [];
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

async function tagWithGeminiWithRetry(ai, tempPath, mimeType, prompt, responseSchema, rotateGeminiApiKey, getCurrentGeminiApiKey, attempt = 1) {
  try {
    return await tagWithGemini(ai, tempPath, mimeType, prompt, responseSchema);
  } catch (err) {
    if (err instanceof DailyQuotaError || isDailyQuotaError(err)) {
      if (rotateGeminiApiKey && rotateGeminiApiKey()) {
        const apiKey = getCurrentGeminiApiKey();
        const newAi = new GoogleGenAI({ apiKey });
        return tagWithGeminiWithRetry(newAi, tempPath, mimeType, prompt, responseSchema, rotateGeminiApiKey, getCurrentGeminiApiKey, 1);
      }
      throw new DailyQuotaError(err.message || "Daily quota exhausted on all keys");
    }
    if (isRateLimitError(err) && attempt < 3) {
      const backoffMs = [2000, 5000, 10000][attempt - 1] || 10000;
      console.log(`Backing off ${backoffMs / 1000}s, retrying...`);
      await sleep(backoffMs);
      return tagWithGeminiWithRetry(ai, tempPath, mimeType, prompt, responseSchema, rotateGeminiApiKey, getCurrentGeminiApiKey, attempt + 1);
    }
    throw err;
  }
}

async function tagWithGemini(ai, tempPath, mimeType, prompt, responseSchema) {
  const uploadedFile = await ai.files.upload({
    file: tempPath,
    config: { mimeType: mimeType || "video/mp4" },
  });

  let activeFile = uploadedFile;
  while (activeFile.state === "PROCESSING") {
    await sleep(3000);
    activeFile = await ai.files.get({ name: activeFile.name });
  }
  if (activeFile.state !== "ACTIVE") {
    throw new Error(`Gemini processing failed: ${activeFile.state}`);
  }

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: activeFile.uri, mimeType: activeFile.mimeType } },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const rawText = response.text?.trim();
  if (!rawText) {
    throw new Error("Gemini returned an empty response");
  }

  const cleaned = rawText.replace(/^```json/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

function normalizeSegment(segment, index) {
  if (!segment || typeof segment !== "object") {
    throw new Error(`Gemini segment ${index} was not an object`);
  }

  const startSeconds = Number(segment.start_seconds);
  const endSeconds = Number(segment.end_seconds);
  const visualDescription = String(segment.visual_description || "").trim();
  const environmentDescription = String(segment.environment_description || "").trim();
  const onScreenText = String(segment.on_screen_text || "").trim();
  const peopleDescription = String(segment.people_description || "").trim();
  const spokenText = String(segment.spoken_text || "").trim();

  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    throw new Error(`Gemini segment ${index} is missing valid timestamps`);
  }
  if (!visualDescription) {
    throw new Error(`Gemini segment ${index} is missing visual_description`);
  }

  return {
    segment_index: index,
    start_seconds: startSeconds,
    end_seconds: endSeconds,
    visual_description: visualDescription,
    environment_description: environmentDescription,
    on_screen_text: onScreenText,
    people_description: peopleDescription,
    spoken_text: spokenText,
  };
}

function buildSegmentEmbedInput(visualDescription, spokenText, environmentDescription, onScreenText, peopleDescription) {
  const parts = [visualDescription || ""];
  if (environmentDescription) parts.push(`Environment: ${environmentDescription}`);
  if (onScreenText) parts.push(`Text: ${onScreenText}`);
  if (peopleDescription) parts.push(`People: ${peopleDescription}`);
  if (spokenText) parts.push(`Spoken: ${spokenText}`);
  return parts.join(" ");
}

function deriveClipCaptionFromSegments(segments) {
  const firstSegment = (segments || []).find((segment) => String(segment.visual_description || "").trim());
  return firstSegment ? String(firstSegment.visual_description).trim() : "";
}

function isRateLimitError(err) {
  const msg = (err.message || "").toLowerCase();
  return msg.includes("429") || msg.includes("resource_exhausted") || msg.includes("quota");
}

function isServiceUnavailableError(err) {
  const msg = (err.message || "").toLowerCase();
  return msg.includes("503") || msg.includes("unavailable") || msg.includes("high demand");
}

function isDailyQuotaError(err) {
  const msg = (err.message || "").toLowerCase();
  return msg.includes("per day") || msg.includes("daily") || msg.includes("free_tier_requests") || (msg.includes("quota exceeded") && msg.includes("free tier"));
}

function isDuplicateSegmentInsertError(err) {
  const msg = (err.message || "").toLowerCase();
  return msg.includes("duplicate key value violates unique constraint") && msg.includes("raw_clip_segments_ad_id_segment_index_key");
}

function isRetryableProcessingError(err) {
  return isRateLimitError(err) || isServiceUnavailableError(err) || isDuplicateSegmentInsertError(err);
}

function isRetryableErrorMessage(message) {
  const msg = String(message || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("high demand") ||
    (msg.includes("duplicate key value violates unique constraint") &&
      msg.includes("raw_clip_segments_ad_id_segment_index_key"))
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  if (err instanceof DailyQuotaError) {
    process.exit(QUOTA_EXIT_CODE);
  }
  console.error(err);
  process.exit(1);
});
