export type RawClipSegmentMatch = {
  segment_id: string;
  raw_clip_id?: string | null;
  ad_id: string;
  segment_index: number | string;
  start_seconds: number | string;
  end_seconds: number | string;
  visual_description: string;
  spoken_text: string;
  on_screen_text: string | null;
  environment_description: string | null;
  people_description: string | null;
  similarity: number | string;
};

export type RawClipGroupedMatch = {
  raw_clip_id?: string | null;
  ad_id: string;
  segment_id: string;
  segment_index: number;
  start_seconds: number;
  end_seconds: number;
  visual_description: string;
  spoken_text: string;
  on_screen_text: string;
  environment_description: string;
  people_description: string;
  similarity: number;
};

export declare function getRawClipEmbeddingModel(): string;
export declare function getRawClipGeminiEmbeddingModel(): string;
export declare function getRawClipEmbedder(): Promise<unknown>;
export declare function embedRawClipText(text: string): Promise<number[]>;
export declare function embedWithGemini(text: string): Promise<number[]>;
export declare function buildSegmentEmbedInput(
  visualDescription: string,
  spokenText: string,
  environmentDescription?: string | null,
  onScreenText?: string | null,
  peopleDescription?: string | null,
): string;
export declare function groupSegmentMatchesByClip(matches: RawClipSegmentMatch[], limit?: number): RawClipGroupedMatch[];
export declare class DailyQuotaError extends Error {}
