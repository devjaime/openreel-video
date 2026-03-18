/**
 * Whisper Web Worker
 *
 * Runs @huggingface/transformers (ONNX runtime) in a dedicated thread so the
 * main UI thread is never blocked during model loading or transcription.
 *
 * Message protocol (defined in packages/core/src/audio/whisper/types.ts):
 *   Main → Worker : WorkerTranscribeMessage  { type:'transcribe', audio, language, modelId }
 *   Worker → Main : WorkerProgressMessage    { type:'progress',   phase, progress, message }
 *                   WorkerResultMessage      { type:'result',     words, text }
 *                   WorkerErrorMessage       { type:'error',      message }
 *
 * Model caching:
 *   The loaded pipeline is reused across calls in the same Worker lifetime.
 *   On first use the ONNX weights are downloaded and stored in the browser's
 *   Cache Storage (managed by @huggingface/transformers internally).
 *
 * Audio input:
 *   Float32Array at 16 kHz mono (already resampled by LocalWhisperEngine).
 */

import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";

import type {
  WorkerInMessage,
  WorkerOutMessage,
  WorkerResultMessage,
  WorkerProgressMessage,
  WorkerErrorMessage,
  WhisperWord,
} from "@openreel/core";

// ---------------------------------------------------------------------------
// Transformers.js environment configuration
// ---------------------------------------------------------------------------

// Only use remote (HuggingFace Hub) models; cache them in the browser.
env.allowLocalModels = false;
env.useBrowserCache = true;

// ---------------------------------------------------------------------------
// Pipeline cache – reused across messages within the same Worker instance
// ---------------------------------------------------------------------------

let cachedPipeline: AutomaticSpeechRecognitionPipeline | null = null;
let cachedModelId: string | null = null;

// ---------------------------------------------------------------------------
// Utility – typed postMessage helpers
// ---------------------------------------------------------------------------

function sendProgress(phase: string, progress: number, message: string): void {
  const msg: WorkerProgressMessage = { type: "progress", phase, progress, message };
  self.postMessage(msg);
}

function sendResult(words: WhisperWord[], text: string): void {
  const msg: WorkerResultMessage = { type: "result", words, text };
  self.postMessage(msg);
}

function sendError(message: string): void {
  const msg: WorkerErrorMessage = { type: "error", message };
  self.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Model loader
// ---------------------------------------------------------------------------

async function loadPipeline(
  modelId: string,
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cachedPipeline && cachedModelId === modelId) {
    return cachedPipeline;
  }

  sendProgress("loading-model", 0, "Iniciando descarga del modelo…");

  const asr = await pipeline("automatic-speech-recognition", modelId, {
    // q4 quantization = ~4× smaller download, minimal accuracy loss
    dtype: "q4",
    progress_callback: (info: ProgressInfo) => {
      if (info.status === "downloading") {
        const pct = Math.round((info.progress ?? 0));
        sendProgress(
          "loading-model",
          pct,
          `Descargando modelo… ${pct}%`,
        );
      } else if (info.status === "ready") {
        sendProgress("loading-model", 100, "Modelo listo");
      }
    },
  });

  cachedPipeline = asr as AutomaticSpeechRecognitionPipeline;
  cachedModelId = modelId;
  return cachedPipeline;
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * Extract word-level timestamps from the pipeline output.
 *
 * @huggingface/transformers returns chunks when `return_timestamps:'word'` is
 * set. Each chunk has the shape:
 *   { text: string, timestamp: [start: number, end: number] }
 *
 * If the model does not produce word chunks (e.g. tiny with short audio), we
 * fall back to a single segment spanning the whole duration.
 */
function extractWords(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any,
  audioDuration: number,
): WhisperWord[] {
  const chunks: Array<{ text: string; timestamp: [number, number | null] }> =
    output?.chunks ?? [];

  if (chunks.length > 0) {
    return chunks
      .filter((c) => c.text && c.text.trim().length > 0)
      .map((c) => ({
        word: c.text.trim(),
        start: c.timestamp[0] ?? 0,
        // Some models omit the end timestamp; use start + 300 ms as fallback
        end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 0.3,
      }));
  }

  // Fallback – no word chunks available
  const text: string = (output?.text ?? "").trim();
  if (!text) return [];

  return [{ word: text, start: 0, end: audioDuration }];
}

async function handleTranscribe(
  audio: Float32Array,
  language: string,
  modelId: string,
): Promise<void> {
  try {
    const asr = await loadPipeline(modelId);

    sendProgress("transcribing", 5, "Transcribiendo audio…");

    const result = await asr(audio, {
      language,
      task: "transcribe",
      return_timestamps: "word",
      // Process in 30-second chunks with 5-second overlap for long audio
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    // Normalise: pipeline may return an array or a single object
    const output = Array.isArray(result) ? result[0] : result;

    if (!output) {
      sendError("El modelo no devolvió ningún resultado.");
      return;
    }

    sendProgress("transcribing", 95, "Procesando resultado…");

    const audioDurationSecs = audio.length / 16_000;
    const words = extractWords(output, audioDurationSecs);
    const text: string = (output.text ?? "").trim();

    sendResult(words, text);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error desconocido en el worker";
    sendError(message);
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  if (msg.type === "transcribe") {
    handleTranscribe(msg.audio, msg.language, msg.modelId);
  }
};
