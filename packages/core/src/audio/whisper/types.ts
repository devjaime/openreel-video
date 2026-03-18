/**
 * Types for the local Whisper transcription engine.
 *
 * Uses @huggingface/transformers (ONNX runtime) running entirely in the browser
 * via a Web Worker. No backend required.
 */

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

export type WhisperModelKey = "tiny" | "small" | "medium" | "large-v3-turbo";

export interface WhisperModelConfig {
  /** HuggingFace model ID */
  readonly id: string;
  readonly name: string;
  readonly sizeMB: number;
  readonly description: string;
}

export const WHISPER_MODELS: Record<WhisperModelKey, WhisperModelConfig> = {
  tiny: {
    id: "onnx-community/whisper-tiny",
    name: "Tiny (fastest)",
    sizeMB: 39,
    description: "Fastest, lower accuracy",
  },
  small: {
    id: "onnx-community/whisper-small",
    name: "Small",
    sizeMB: 150,
    description: "Balanced speed / accuracy",
  },
  medium: {
    id: "onnx-community/whisper-medium",
    name: "Medium",
    sizeMB: 450,
    description: "Higher accuracy",
  },
  "large-v3-turbo": {
    id: "onnx-community/whisper-large-v3-turbo",
    name: "Large Turbo (best)",
    sizeMB: 800,
    description: "Best accuracy",
  },
};

// ---------------------------------------------------------------------------
// Supported languages
// ---------------------------------------------------------------------------

export interface WhisperLanguage {
  readonly code: string; // ISO 639-1, e.g. "es"
  readonly name: string;
}

export const WHISPER_LANGUAGES: WhisperLanguage[] = [
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "ru", name: "Русский" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "中文" },
  { code: "ko", name: "한국어" },
  { code: "ar", name: "العربية" },
  { code: "tr", name: "Türkçe" },
  { code: "sv", name: "Svenska" },
  { code: "da", name: "Dansk" },
  { code: "fi", name: "Suomi" },
  { code: "no", name: "Norsk" },
  { code: "cs", name: "Čeština" },
  { code: "uk", name: "Українська" },
];

// ---------------------------------------------------------------------------
// Transcription options
// ---------------------------------------------------------------------------

export interface WhisperTranscribeOptions {
  /** ISO 639-1 language code. Default: "es" */
  language?: string;
  /** Model size to use. Default: "tiny" */
  model?: WhisperModelKey;
  /** Max duration (seconds) per subtitle segment. Default: 5 */
  maxSegmentDuration?: number;
  /** Max words per subtitle segment. Default: 10 */
  maxWordsPerSegment?: number;
  /** Animation style applied to generated subtitles. Default: "karaoke" */
  animationStyle?: "none" | "word-highlight" | "karaoke" | "word-by-word";
}

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

export type WhisperProgressPhase =
  | "loading-model"
  | "extracting-audio"
  | "transcribing"
  | "processing"
  | "complete"
  | "error";

export interface WhisperProgress {
  readonly phase: WhisperProgressPhase;
  /** 0–100 */
  readonly progress: number;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Worker message protocol
// ---------------------------------------------------------------------------

/** Main thread → Worker */
export interface WorkerTranscribeMessage {
  type: "transcribe";
  audio: Float32Array;
  language: string;
  modelId: string;
}

/** Worker → Main thread: word-level result */
export interface WorkerResultMessage {
  type: "result";
  words: WhisperWord[];
  text: string;
}

/** Worker → Main thread: progress update */
export interface WorkerProgressMessage {
  type: "progress";
  phase: string;
  /** 0–100 */
  progress: number;
  message: string;
}

/** Worker → Main thread: unrecoverable error */
export interface WorkerErrorMessage {
  type: "error";
  message: string;
}

export type WorkerInMessage = WorkerTranscribeMessage;
export type WorkerOutMessage =
  | WorkerResultMessage
  | WorkerProgressMessage
  | WorkerErrorMessage;

// ---------------------------------------------------------------------------
// Word-level timestamp (internal, matches Cloudflare Whisper shape)
// ---------------------------------------------------------------------------

export interface WhisperWord {
  readonly word: string;
  /** Seconds from the start of the audio segment */
  readonly start: number;
  readonly end: number;
}
