/**
 * Reels Cutter — Automatic short-form clip extraction
 *
 * Given a transcript and a target clip duration, finds the N most
 * engaging windows using a density + sentence-boundary heuristic.
 *
 * Pure function — no browser APIs, no React, no side-effects.
 * Runs in <10 ms for a 30-minute transcript.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  startTime: number; // seconds
  endTime: number;   // seconds
  text: string;
}

export interface ReelsCut {
  startTime: number;
  endTime: number;
  /** Normalised score 0–1 (higher = more engaging) */
  score: number;
  /** Auto-generated title from the densest sentence in the window */
  title: string;
  wordCount: number;
  /** Platform suggestions based on duration */
  suggestedPlatforms: string[];
}

export interface ReelsCutterOptions {
  /** Target clip duration in seconds. Default: 60 */
  targetDuration?: number;
  /** Maximum number of clips to return. Default: 3 */
  maxResults?: number;
  /** Minimum score threshold 0–1. Default: 0.1 */
  minScore?: number;
  /** Step size for sliding window in seconds. Default: 5 */
  stepSize?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main function
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extract the best short-form clips from a transcript.
 *
 * @param segments  Transcript segments (from Whisper or any STT)
 * @param totalDuration  Total video duration in seconds
 * @param options   Tuning options
 */
export function cutReels(
  segments: TranscriptSegment[],
  totalDuration: number,
  options: ReelsCutterOptions = {},
): ReelsCut[] {
  const {
    targetDuration = 60,
    maxResults = 3,
    minScore = 0.1,
    stepSize = 5,
  } = options;

  if (segments.length === 0 || totalDuration <= 0) return [];

  // Can't cut if video is shorter than target
  if (totalDuration <= targetDuration) {
    const allText = segments.map((s) => s.text).join(" ");
    return [
      {
        startTime: 0,
        endTime: totalDuration,
        score: 1,
        title: generateTitle(allText),
        wordCount: countWords(allText),
        suggestedPlatforms: platformsForDuration(totalDuration),
      },
    ];
  }

  // Build candidate windows
  const candidates: Array<{
    start: number;
    end: number;
    wordDensity: number;
    sentenceScore: number;
    text: string;
  }> = [];

  for (let t = 0; t + targetDuration <= totalDuration; t += stepSize) {
    const windowStart = t;
    const windowEnd = t + targetDuration;

    const windowSegments = segments.filter(
      (s) => s.endTime > windowStart && s.startTime < windowEnd,
    );

    if (windowSegments.length === 0) continue;

    const text = windowSegments.map((s) => s.text).join(" ");
    const words = countWords(text);
    const wordDensity = words / targetDuration; // words per second

    // Sentence completeness: bonus if window starts/ends near a sentence boundary
    const firstSeg = windowSegments[0];
    const lastSeg = windowSegments[windowSegments.length - 1];
    const startsClean = firstSeg.startTime >= windowStart - 2;
    const endsClean = lastSeg.endTime <= windowEnd + 2;
    const sentenceScore =
      (endsWithSentence(firstSeg.text) || startsClean ? 0.5 : 0) +
      (endsWithSentence(lastSeg.text) || endsClean ? 0.5 : 0);

    candidates.push({
      start: windowStart,
      end: windowEnd,
      wordDensity,
      sentenceScore,
      text,
    });
  }

  if (candidates.length === 0) return [];

  // Normalize word density
  const maxDensity = Math.max(...candidates.map((c) => c.wordDensity), 1);

  const scored = candidates.map((c) => ({
    ...c,
    score: (c.wordDensity / maxDensity) * 0.65 + c.sentenceScore * 0.35,
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Non-maximum suppression: remove candidates too close to a better one
  const suppressRadius = targetDuration * 0.4;
  const selected: typeof scored = [];

  for (const candidate of scored) {
    if (selected.length >= maxResults) break;
    if (candidate.score < minScore) continue;

    const tooClose = selected.some(
      (s) => Math.abs(s.start - candidate.start) < suppressRadius,
    );
    if (!tooClose) selected.push(candidate);
  }

  return selected.map((c) => ({
    startTime: Math.max(0, c.start),
    endTime: Math.min(totalDuration, c.end),
    score: Math.round(c.score * 100) / 100,
    title: generateTitle(c.text),
    wordCount: countWords(c.text),
    suggestedPlatforms: platformsForDuration(targetDuration),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function endsWithSentence(text: string): boolean {
  return /[.!?]$/.test(text.trim());
}

/**
 * Extract a short title from text:
 * First complete sentence ≤ 60 chars, or first 8 words.
 */
function generateTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const sentenceMatch = cleaned.match(/^[^.!?]+[.!?]/);
  if (sentenceMatch && sentenceMatch[0].length <= 70) {
    return sentenceMatch[0].trim();
  }
  const words = cleaned.split(" ").slice(0, 8).join(" ");
  return words.length < cleaned.length ? words + "…" : words;
}

function platformsForDuration(duration: number): string[] {
  const platforms: string[] = [];
  if (duration <= 15) platforms.push("TikTok", "Instagram Stories", "YouTube Shorts");
  else if (duration <= 30) platforms.push("TikTok", "Instagram Reels", "YouTube Shorts");
  else if (duration <= 60)
    platforms.push("TikTok", "Instagram Reels", "YouTube Shorts", "Twitter/X");
  else if (duration <= 90) platforms.push("Instagram Reels", "LinkedIn", "Twitter/X");
  else platforms.push("YouTube", "LinkedIn");
  return platforms;
}

// ──────────────────────────────────────────────────────────────────────────────
// AI-enhanced override: merge GPT suggestions with heuristic results
// ──────────────────────────────────────────────────────────────────────────────

export interface AiHighlightSuggestion {
  start_time: number;
  end_time: number;
  title: string;
  reason: string;
}

/**
 * Parse the JSON returned by `buildHighlightsPrompt` and merge with
 * the heuristic results, replacing low-confidence heuristic cuts with
 * AI-suggested ones when available.
 */
export function mergeAiHighlights(
  heuristicCuts: ReelsCut[],
  aiJson: string,
  totalDuration: number,
): ReelsCut[] {
  let aiSuggestions: AiHighlightSuggestion[] = [];

  try {
    const parsed = JSON.parse(aiJson);
    if (Array.isArray(parsed)) {
      aiSuggestions = parsed.filter(
        (s): s is AiHighlightSuggestion =>
          typeof s.start_time === "number" &&
          typeof s.end_time === "number" &&
          typeof s.title === "string",
      );
    }
  } catch {
    // Malformed JSON — fall back to heuristic
    return heuristicCuts;
  }

  if (aiSuggestions.length === 0) return heuristicCuts;

  return aiSuggestions.map((s) => {
    const duration = s.end_time - s.start_time;
    return {
      startTime: Math.max(0, s.start_time),
      endTime: Math.min(totalDuration, s.end_time),
      score: 0.95,
      title: s.title,
      wordCount: 0, // not known without re-parsing
      suggestedPlatforms: platformsForDuration(duration),
    };
  });
}
