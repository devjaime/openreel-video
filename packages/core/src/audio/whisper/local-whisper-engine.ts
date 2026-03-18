/**
 * LocalWhisperEngine
 *
 * Runs Whisper (ONNX) entirely in the browser via a Web Worker.
 * The caller must supply a `workerFactory` function that creates the Worker
 * (so this package stays framework-agnostic and Vite-independent).
 *
 * Integration with the subtitle system:
 * - Output type: `Subtitle[]` (packages/core/src/types/timeline.ts)
 * - Each Subtitle includes `words: SubtitleWord[]` for karaoke-style rendering
 * - SRT export is delegated to the existing `exportSRT` utility
 *
 * Audio pipeline:
 *   MediaItem (blob / FileSystemFileHandle)
 *     → AudioContext.decodeAudioData()
 *     → OfflineAudioContext (resample to 16 kHz mono)
 *     → Float32Array → Worker → Whisper → WhisperWord[]
 *     → groupWordsIntoSubtitles() → Subtitle[]
 */

import type { Subtitle, SubtitleStyle } from "../../types/timeline";
import type { Clip } from "../../types/timeline";
import type { MediaItem } from "../../types/project";
import { exportSRT } from "../../text/subtitle-engine";
import {
  type WhisperTranscribeOptions,
  type WhisperProgress,
  type WorkerOutMessage,
  type WorkerInMessage,
  type WhisperWord,
  WHISPER_MODELS,
  WHISPER_LANGUAGES,
} from "./types";

// Re-export helpers so callers can discover supported models/languages
export { WHISPER_MODELS, WHISPER_LANGUAGES };

// ---------------------------------------------------------------------------
// Default subtitle style for Whisper-generated subtitles
// Includes highlight colours so karaoke rendering works out of the box.
// ---------------------------------------------------------------------------

const DEFAULT_WHISPER_STYLE: SubtitleStyle = {
  fontFamily: "Arial",
  fontSize: 24,
  color: "#ffffff",
  backgroundColor: "rgba(0, 0, 0, 0.75)",
  position: "bottom",
  highlightColor: "#FFD700",
  upcomingColor: "rgba(255, 255, 255, 0.55)",
};

/** Unique ID generator for subtitle objects */
function makeSubId(): string {
  return `sub-w-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// LocalWhisperEngine
// ---------------------------------------------------------------------------

export class LocalWhisperEngine {
  private worker: Worker | null = null;
  private readonly workerFactory: () => Worker;

  /**
   * @param workerFactory  Called once (lazily) to instantiate the Web Worker.
   *
   * Example from apps/web:
   * ```ts
   * const engine = new LocalWhisperEngine(
   *   () => new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' })
   * );
   * ```
   */
  constructor(workerFactory: () => Worker) {
    this.workerFactory = workerFactory;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Transcribe the audio track of a clip and return editor-ready subtitles.
   *
   * @param clip        The clip to transcribe.
   * @param mediaItem   The underlying media file (needs blob or fileHandle).
   * @param options     Language, model, segmentation settings.
   * @param onProgress  Optional callback for UI progress updates.
   */
  async transcribeClip(
    clip: Clip,
    mediaItem: MediaItem,
    options: WhisperTranscribeOptions = {},
    onProgress?: (p: WhisperProgress) => void,
  ): Promise<Subtitle[]> {
    const {
      language = "es",
      model = "tiny",
      maxSegmentDuration = 5,
      maxWordsPerSegment = 10,
      animationStyle = "karaoke",
    } = options;

    const modelConfig = WHISPER_MODELS[model];

    // Step 1 – extract audio
    onProgress?.({
      phase: "extracting-audio",
      progress: 5,
      message: "Extrayendo audio del video…",
    });

    const audioData = await this.extractAudio(clip, mediaItem);

    // Step 2 – run Whisper in worker
    onProgress?.({
      phase: "loading-model",
      progress: 10,
      message: `Cargando modelo (${modelConfig.sizeMB} MB)…`,
    });

    const words = await this.runInWorker(
      audioData,
      language,
      modelConfig.id,
      (workerProgress) => {
        // Worker reports 0-100 for its own phase; remap to 10-88 of total.
        const mapped = 10 + Math.round((workerProgress.progress / 100) * 78);
        onProgress?.({
          phase: workerProgress.phase === "loading-model"
            ? "loading-model"
            : "transcribing",
          progress: Math.min(mapped, 88),
          message: workerProgress.message,
        });
      },
    );

    // Step 3 – build subtitle objects
    onProgress?.({
      phase: "processing",
      progress: 90,
      message: "Generando subtítulos…",
    });

    const subtitles = this.groupWordsIntoSubtitles(
      words,
      clip.startTime,
      maxWordsPerSegment,
      maxSegmentDuration,
      animationStyle,
    );

    onProgress?.({
      phase: "complete",
      progress: 100,
      message: `${subtitles.length} subtítulo${subtitles.length !== 1 ? "s" : ""} generados`,
    });

    return subtitles;
  }

  /**
   * Convert an array of Subtitle objects to SRT format.
   * Delegates to the existing `exportSRT` utility so output is consistent
   * with the rest of the editor.
   */
  toSRT(subtitles: readonly Subtitle[]): string {
    return exportSRT(subtitles);
  }

  /** Free the worker and audio context. */
  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract audio from the media item and resample it to 16 kHz mono
   * (Whisper's expected input format).
   *
   * The OfflineAudioContext handles resampling automatically when the
   * rendering sample rate differs from the source buffer's sample rate.
   */
  private async extractAudio(
    clip: Clip,
    mediaItem: MediaItem,
  ): Promise<Float32Array> {
    let arrayBuffer: ArrayBuffer;

    if (mediaItem.blob) {
      arrayBuffer = await mediaItem.blob.arrayBuffer();
    } else if (mediaItem.fileHandle) {
      const file = await mediaItem.fileHandle.getFile();
      arrayBuffer = await file.arrayBuffer();
    } else {
      throw new Error(
        "LocalWhisperEngine: no blob or fileHandle found in MediaItem.",
      );
    }

    // Decode at the file's native sample rate
    const decodeCtx = new AudioContext();
    let srcBuffer: AudioBuffer;
    try {
      srcBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    } finally {
      decodeCtx.close();
    }

    const inPoint = clip.inPoint ?? 0;
    const outPoint = clip.outPoint ?? srcBuffer.duration;
    const duration = Math.min(outPoint - inPoint, clip.duration);

    const TARGET_RATE = 16_000; // Hz – Whisper standard
    const numSamples = Math.ceil(duration * TARGET_RATE);

    // Mono, 16 kHz offline render
    const offline = new OfflineAudioContext(1, numSamples, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = srcBuffer;
    source.connect(offline.destination);
    // start(when, offset, duration) – offset trims the clip inPoint
    source.start(0, inPoint, duration);

    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  }

  /**
   * Send audio to the Web Worker and wait for the word-level result.
   * The Float32Array buffer is transferred (not copied) for performance.
   */
  private runInWorker(
    audio: Float32Array,
    language: string,
    modelId: string,
    onWorkerProgress?: (p: { phase: string; progress: number; message: string }) => void,
  ): Promise<WhisperWord[]> {
    return new Promise<WhisperWord[]>((resolve, reject) => {
      const worker = this.getOrCreateWorker();

      const handleMessage = (event: MessageEvent<WorkerOutMessage>) => {
        const msg = event.data;

        if (msg.type === "result") {
          worker.removeEventListener("message", handleMessage);
          worker.removeEventListener("error", handleError);
          resolve(msg.words);
        } else if (msg.type === "progress") {
          onWorkerProgress?.({
            phase: msg.phase,
            progress: msg.progress,
            message: msg.message,
          });
        } else if (msg.type === "error") {
          worker.removeEventListener("message", handleMessage);
          worker.removeEventListener("error", handleError);
          reject(new Error(msg.message));
        }
      };

      const handleError = (event: ErrorEvent) => {
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        reject(new Error(`Whisper worker error: ${event.message}`));
      };

      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleError);

      // Transfer the underlying buffer to avoid a copy
      const transferBuffer = audio.buffer.slice(0) as ArrayBuffer;
      const transferableAudio = new Float32Array(transferBuffer);

      const msg: WorkerInMessage = {
        type: "transcribe",
        audio: transferableAudio,
        language,
        modelId,
      };

      worker.postMessage(msg, [transferBuffer]);
    });
  }

  private getOrCreateWorker(): Worker {
    if (!this.worker) {
      this.worker = this.workerFactory();
    }
    return this.worker;
  }

  /**
   * Group a flat list of word timestamps into Subtitle segments.
   *
   * Segmentation rules (in priority order):
   *  1. Sentence-ending punctuation (. ! ? ;) after ≥ 3 words → flush segment
   *  2. maxWordsPerSegment exceeded → flush before adding new word
   *  3. maxSegmentDuration (seconds) exceeded → flush before adding new word
   */
  private groupWordsIntoSubtitles(
    words: WhisperWord[],
    clipStartTime: number,
    maxWords: number,
    maxDuration: number,
    animationStyle: NonNullable<WhisperTranscribeOptions["animationStyle"]>,
  ): Subtitle[] {
    if (words.length === 0) return [];

    const subtitles: Subtitle[] = [];
    let buffer: WhisperWord[] = [];
    let segmentStart = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      subtitles.push(this.buildSubtitle(buffer, clipStartTime, animationStyle));
      buffer = [];
    };

    for (const word of words) {
      if (buffer.length === 0) {
        segmentStart = word.start;
      }

      const wouldExceedWords = buffer.length >= maxWords;
      const wouldExceedDuration = word.end - segmentStart > maxDuration;

      if ((wouldExceedWords || wouldExceedDuration) && buffer.length > 0) {
        flush();
        segmentStart = word.start;
      }

      buffer.push(word);

      // Natural sentence boundary → flush after short segments
      if (/[.!?;]$/.test(word.word.trim()) && buffer.length >= 3) {
        flush();
      }
    }

    flush();
    return subtitles;
  }

  private buildSubtitle(
    words: WhisperWord[],
    clipStartTime: number,
    animationStyle: NonNullable<WhisperTranscribeOptions["animationStyle"]>,
  ): Subtitle {
    const text = words
      .map((w) => w.word)
      .join(" ")
      .trim();

    return {
      id: makeSubId(),
      text,
      startTime: clipStartTime + words[0].start,
      endTime: clipStartTime + words[words.length - 1].end,
      style: DEFAULT_WHISPER_STYLE,
      words: words.map((w) => ({
        text: w.word,
        startTime: clipStartTime + w.start,
        endTime: clipStartTime + w.end,
      })),
      animationStyle,
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (mirrors the pattern used by TranscriptionService)
// ---------------------------------------------------------------------------

let _instance: LocalWhisperEngine | null = null;

/** Returns the current singleton, or null if not yet initialised. */
export function getLocalWhisperEngine(): LocalWhisperEngine | null {
  return _instance;
}

/**
 * Create (or replace) the singleton.
 *
 * @param workerFactory  Called once, lazily, when the first transcription starts.
 */
export function initializeLocalWhisperEngine(
  workerFactory: () => Worker,
): LocalWhisperEngine {
  _instance?.dispose();
  _instance = new LocalWhisperEngine(workerFactory);
  return _instance;
}

export function disposeLocalWhisperEngine(): void {
  _instance?.dispose();
  _instance = null;
}
