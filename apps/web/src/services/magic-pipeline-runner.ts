/**
 * Magic Pipeline Runner
 *
 * Orchestrates all 9 processing stages in sequence.
 * Called from MagicPipelinePanel when the user clicks "Publicar en Redes".
 *
 * Each stage updates the Zustand store via the _set* actions.
 * Aborting sets _abortSignal which every stage checks between steps.
 */
import {
  StemSeparator,
  SpectralNoiseReducer,
  detectFillers,
  cutReels,
  mergeAiHighlights,
  getOpenRouterClient,
  buildThumbnailPrompt,
  buildHighlightsPrompt,
  SOCIAL_PLATFORM_SPECS,
  type SocialPlatformId,
  // Google AI
  getGoogleAiClient,
  getActiveAiProvider,
} from "@openreel/core";
import {
  useMagicPipelineStore,
  type PipelineConfig,
  type PipelineStepId,
} from "../stores/magic-pipeline-store";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { toast } from "../stores/notification-store";

// ──────────────────────────────────────────────────────────────────────────────
// In-memory writable stream → auto-downloads as a file when .close() is called
// (mirrors the fallback logic in Toolbar.tsx for browsers without showSaveFilePicker)
// ──────────────────────────────────────────────────────────────────────────────
function createDownloadStream(filename: string, mime: string): FileSystemWritableFileStream {
  let buffer = new Uint8Array(32 * 1024 * 1024); // 32 MB initial
  let length = 0;
  let cursor = 0;

  const grow = (needed: number) => {
    if (needed <= buffer.length) return;
    let newSize = buffer.length;
    while (newSize < needed) newSize *= 2;
    const next = new Uint8Array(newSize);
    next.set(buffer.subarray(0, length));
    buffer = next;
  };

  const writeBytes = (bytes: Uint8Array, position: number) => {
    const end = position + bytes.byteLength;
    grow(end);
    buffer.set(bytes, position);
    if (end > length) length = end;
    cursor = end;
  };

  return {
    seek(position: number) {
      cursor = position;
      return Promise.resolve();
    },
    write(data: unknown) {
      if (data instanceof ArrayBuffer) {
        writeBytes(new Uint8Array(data), cursor);
      } else if (ArrayBuffer.isView(data)) {
        writeBytes(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), cursor);
      }
      return Promise.resolve();
    },
    close() {
      const blob = new Blob([buffer.slice(0, length)], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return Promise.resolve();
    },
    abort() { return Promise.resolve(); },
    truncate(size: number) {
      if (size < length) length = size;
      return Promise.resolve();
    },
  } as unknown as FileSystemWritableFileStream;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function store() {
  return useMagicPipelineStore.getState();
}

function project() {
  return useProjectStore.getState().project;
}

function shouldAbort(): boolean {
  return store()._abortSignal;
}

function setRunning(id: PipelineStepId) {
  store()._setStepStatus(id, "running");
}

function setDone(id: PipelineStepId, detail?: string) {
  store()._setStepStatus(id, "done", detail);
  store()._setStepProgress(id, 100);
}

function setSkipped(id: PipelineStepId, reason?: string) {
  store()._setStepStatus(id, "skipped", reason ?? "Omitido");
  store()._setStepProgress(id, 100);
}

function setError(id: PipelineStepId, error: string) {
  store()._setStepError(id, error);
}

function setProgress(id: PipelineStepId, pct: number) {
  store()._setStepProgress(id, Math.round(pct * 100));
}

function isEnabled(id: PipelineStepId): boolean {
  return store().steps.find((s) => s.id === id)?.enabled ?? false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main runner
// ──────────────────────────────────────────────────────────────────────────────

export async function runMagicPipeline(config: PipelineConfig): Promise<void> {
  store()._startPipeline();

  const audioCtx = new AudioContext();
  let voiceBuffer: AudioBuffer | null = null;
  let transcriptText = "";
  let transcriptSegments: Array<{ startTime: number; endTime: number; text: string }> = [];
  const activeProvider = getActiveAiProvider(); // "google" | "openrouter" | null
  const hasApiKey = !!activeProvider;

  try {
    // ── Step 1: Stem separation ───────────────────────────────────────────────
    if (isEnabled("stem-separation")) {
      setRunning("stem-separation");
      try {
        const clip = getFirstAudioClip();
        if (!clip || (!clip["src"] && !clip["url"])) {
          setSkipped("stem-separation", "No hay clip de audio en el timeline");
        } else {
          const audioBuffer = await decodeClipAudio(clip, audioCtx);
          const mono = monoMix(audioBuffer);
          const separator = new StemSeparator({ fftSize: 2048, hopSize: 512 });
          const result = await separator.separate(mono, audioBuffer.sampleRate, (f) =>
            setProgress("stem-separation", f),
          );
          voiceBuffer = audioCtx.createBuffer(1, result.voice.length, result.sampleRate);
          voiceBuffer.copyToChannel(Float32Array.from(result.voice), 0);
          setDone("stem-separation", "Voz y fondo separados");
        }
      } catch (e) {
        setError("stem-separation", errMsg(e));
      }
    } else {
      setSkipped("stem-separation");
    }

    if (shouldAbort()) return finishAborted();

    // ── Step 2: Audio enhancement ─────────────────────────────────────────────
    if (isEnabled("audio-enhancement")) {
      setRunning("audio-enhancement");
      try {
        const targetBuffer = voiceBuffer ?? (await getFirstAudioBuffer(audioCtx));
        if (!targetBuffer) {
          setSkipped("audio-enhancement", "No hay audio disponible");
        } else {
          setProgress("audio-enhancement", 0.2);
          const reducer = new SpectralNoiseReducer({ reduction: 0.6 });
          // Auto-learn noise profile from first 2 seconds
          const profileSegment = sliceBuffer(targetBuffer, 0, Math.min(2, targetBuffer.duration), audioCtx);
          reducer.learnNoiseProfile(profileSegment);
          setProgress("audio-enhancement", 0.5);
          const cleaned = await reducer.processBuffer(targetBuffer, audioCtx);
          voiceBuffer = cleaned;
          setProgress("audio-enhancement", 1.0);
          setDone("audio-enhancement", "Ruido suprimido · EQ aplicado");
        }
      } catch (e) {
        setError("audio-enhancement", errMsg(e));
      }
    } else {
      setSkipped("audio-enhancement");
    }

    if (shouldAbort()) return finishAborted();

    // ── Step 3: Silence trimming ──────────────────────────────────────────────
    if (isEnabled("silence-trimming")) {
      setRunning("silence-trimming");
      try {
        const targetBuf = voiceBuffer ?? (await getFirstAudioBuffer(audioCtx));
        if (!targetBuf) {
          setSkipped("silence-trimming", "Sin audio — importa un video primero");
        } else {
          // Detect silence regions (threshold -40 dBFS, min 0.5 s)
          setProgress("silence-trimming", 0.3);
          const data = targetBuf.getChannelData(0);
          const sr = targetBuf.sampleRate;
          const threshold = 0.006; // ≈ -44 dBFS
          const minSilenceSamples = Math.floor(0.5 * sr);
          let silenceCount = 0;
          let inSilence = false;
          let silenceStart = 0;
          for (let i = 0; i < data.length; i++) {
            const isSilent = Math.abs(data[i]) < threshold;
            if (isSilent && !inSilence) { inSilence = true; silenceStart = i; }
            else if (!isSilent && inSilence) {
              if (i - silenceStart >= minSilenceSamples) silenceCount++;
              inSilence = false;
            }
          }
          setProgress("silence-trimming", 1.0);
          if (silenceCount > 0) {
            setDone("silence-trimming", `${silenceCount} silencios detectados — aplica 'Auto-Cortar Silencios' en el inspector`);
          } else {
            setDone("silence-trimming", "Sin silencios largos detectados");
          }
        }
      } catch (e) {
        setError("silence-trimming", errMsg(e));
      }
    } else {
      setSkipped("silence-trimming");
    }

    if (shouldAbort()) return finishAborted();

    // ── Step 4: Transcription ─────────────────────────────────────────────────
    if (isEnabled("transcription")) {
      setRunning("transcription");
      try {
        // Pull subtitles already in the timeline (from WhisperSubtitlePanel)
        const existingSubs = project().timeline?.subtitles ?? [];
        if (existingSubs.length > 0) {
          transcriptSegments = existingSubs.map((s) => ({
            startTime: s.startTime,
            endTime: s.endTime,
            text: s.text ?? s.words?.map((w) => w.text).join(" ") ?? "",
          }));
          transcriptText = transcriptSegments.map((s) => s.text).join(" ");
          setDone("transcription", `${existingSubs.length} subtítulos existentes usados`);
        } else {
          // Instruct user to transcribe first via the Whisper panel
          setSkipped(
            "transcription",
            "Transcribe el video primero con el panel Whisper → los subtítulos se usarán aquí",
          );
        }
      } catch (e) {
        setError("transcription", errMsg(e));
      }
    } else {
      setSkipped("transcription");
    }

    if (shouldAbort()) return finishAborted();

    // ── Step 5: Filler removal ────────────────────────────────────────────────
    if (isEnabled("filler-removal")) {
      setRunning("filler-removal");
      try {
        const subtitles = project().timeline?.subtitles ?? [];
        if (subtitles.length === 0 || transcriptSegments.length === 0) {
          setSkipped("filler-removal", "Sin subtítulos — transcribe primero");
        } else {
          setProgress("filler-removal", 0.3);
          const { stats } = detectFillers(subtitles);
          const totalFillers =
            (stats.byCategory.sound ?? 0) +
            (stats.byCategory.phrase ?? 0) +
            (stats.byCategory.repetition ?? 0);
          setProgress("filler-removal", 1.0);
          setDone(
            "filler-removal",
            totalFillers > 0
              ? `${totalFillers} muletillas detectadas — usa FillerDetector para eliminar`
              : "Sin muletillas detectadas",
          );
        }
      } catch (e) {
        setError("filler-removal", errMsg(e));
      }
    } else {
      setSkipped("filler-removal");
    }

    if (shouldAbort()) return finishAborted();

    // ── Step 6: Subtitles ─────────────────────────────────────────────────────
    if (isEnabled("subtitles")) {
      setRunning("subtitles");
      try {
        if (transcriptSegments.length === 0) {
          setSkipped("subtitles", "Sin transcripción disponible");
        } else {
          setProgress("subtitles", 0.5);
          // Subtitles are added as part of transcription flow; just confirm
          setDone("subtitles", `${transcriptSegments.length} subtítulos listos`);
        }
      } catch (e) {
        setError("subtitles", errMsg(e));
      }
    } else {
      setSkipped("subtitles");
    }

    if (shouldAbort()) return finishAborted();

    // ── Step 7: Reels cutting ─────────────────────────────────────────────────
    if (isEnabled("reels-cutting")) {
      setRunning("reels-cutting");
      try {
        const totalDuration = project().timeline?.duration ?? 0;
        setProgress("reels-cutting", 0.2);

        let cuts = cutReels(transcriptSegments, totalDuration, {
          targetDuration: config.reelsDuration,
          maxResults: config.reelsCount,
        });

        // If AI available, try to improve with smart highlights
        if (hasApiKey && transcriptText.length > 50) {
          try {
            let aiText: string | undefined;
            if (activeProvider === "google") {
              const gc = getGoogleAiClient()!;
              const r = await gc.generateText(buildHighlightsPrompt(transcriptText));
              aiText = r.text;
            } else {
              const oc = getOpenRouterClient()!;
              const r = await oc.ask(buildHighlightsPrompt(transcriptText), "openai/gpt-4o-mini");
              aiText = r.text;
            }
            if (aiText) cuts = mergeAiHighlights(cuts, aiText, totalDuration);
          } catch {
            // AI enhancement failed — keep heuristic cuts
          }
        }

        setProgress("reels-cutting", 1.0);

        if (cuts.length === 0) {
          setSkipped("reels-cutting", "Sin transcripción — transcribe primero para identificar los mejores momentos");
        } else {
          store()._setReelsCuts(
            cuts.map((c) => ({
              title: c.title,
              startTime: c.startTime,
              endTime: c.endTime,
              score: c.score,
            })),
          );
          setDone("reels-cutting", `${cuts.length} reel${cuts.length > 1 ? "s" : ""} identificado${cuts.length > 1 ? "s" : ""}`);
        }
      } catch (e) {
        setError("reels-cutting", errMsg(e));
      }
    } else {
      setSkipped("reels-cutting");
    }

    if (shouldAbort()) return finishAborted();

    // ── Step 8: Thumbnail generation ─────────────────────────────────────────
    if (isEnabled("thumbnail-generation")) {
      if (!hasApiKey && config.skipStepsIfNoApiKey) {
        setSkipped("thumbnail-generation", "Requiere clave de IA (Google AI o OpenRouter)");
      } else {
        setRunning("thumbnail-generation");
        try {
          const prompt = buildThumbnailPrompt(
            transcriptText || "Video profesional",
            project().name || "VideoForge",
            config.thumbnailStyle,
          );

          setProgress("thumbnail-generation", 0.1);

          let imgDataUrl: string | undefined;
          let usedProvider = "";

          // Helper: try Google AI image generation
          const tryGoogle = async (basePrompt: string): Promise<string | undefined> => {
            const gc = getGoogleAiClient();
            if (!gc) return undefined;
            try {
              const conceptRes = await gc.generateText(basePrompt);
              const finalPrompt = conceptRes.success && conceptRes.text ? conceptRes.text : basePrompt;
              const imgRes = await gc.generateImage(finalPrompt, { aspectRatio: "16:9" });
              if (imgRes.success && imgRes.dataUrl) {
                usedProvider = "Gemini (Google)";
                return imgRes.dataUrl;
              }
            } catch { /* fall through */ }
            return undefined;
          };

          // Helper: try OpenRouter DALL-E 3 image generation
          const tryOpenRouter = async (basePrompt: string): Promise<string | undefined> => {
            const oc = getOpenRouterClient();
            if (!oc) return undefined;
            try {
              const conceptRes = await oc.ask(basePrompt);
              const finalPrompt = conceptRes.success && conceptRes.text ? conceptRes.text : basePrompt;
              const imgRes = await oc.generateImage(finalPrompt, { size: "1792x1024", quality: "standard" });
              if (imgRes.success && imgRes.dataUrl) {
                usedProvider = "DALL-E 3 (OpenRouter)";
                return imgRes.dataUrl;
              }
            } catch { /* fall through */ }
            return undefined;
          };

          setProgress("thumbnail-generation", 0.2);

          // Try primary provider, then the other, then skip gracefully
          if (activeProvider === "google") {
            imgDataUrl = await tryGoogle(prompt);
            if (!imgDataUrl) {
              setProgress("thumbnail-generation", 0.5);
              imgDataUrl = await tryOpenRouter(prompt);
            }
          } else {
            imgDataUrl = await tryOpenRouter(prompt);
            if (!imgDataUrl) {
              setProgress("thumbnail-generation", 0.5);
              imgDataUrl = await tryGoogle(prompt);
            }
          }

          setProgress("thumbnail-generation", 1.0);

          if (imgDataUrl) {
            store()._setThumbnail(imgDataUrl);
            setDone("thumbnail-generation", `Generada con ${usedProvider} — descarga abajo`);
          } else {
            // Skip gracefully — don't block the rest of the pipeline
            setSkipped("thumbnail-generation", "No se pudo generar miniatura (continúa con la exportación)");
          }
        } catch (e) {
          setError("thumbnail-generation", errMsg(e));
        }
      }
    } else {
      setSkipped("thumbnail-generation");
    }

    if (shouldAbort()) return finishAborted();

    // ── Step 9: Export packages — genera y descarga un MP4 por plataforma ────
    if (isEnabled("export-packages")) {
      setRunning("export-packages");
      try {
        const platforms = config.exportPlatforms.filter(
          (id) => id in SOCIAL_PLATFORM_SPECS,
        ) as SocialPlatformId[];

        if (platforms.length === 0) {
          setSkipped("export-packages", "Sin plataformas seleccionadas");
        } else {
          const exportEngine = useEngineStore.getState().getExportEngine();
          if (!exportEngine) {
            setError("export-packages", "Motor de exportación no inicializado — abre el editor primero");
          } else {
            await exportEngine.initialize();
            const proj = project();
            const projectName = (proj.name || "VideoForge").replace(/\s+/g, "_");
            const exported: string[] = [];
            const failed: string[] = [];

            for (let i = 0; i < platforms.length; i++) {
              if (shouldAbort()) break;
              const id = platforms[i];
              const spec = SOCIAL_PLATFORM_SPECS[id];
              if (!spec) continue;

              setProgress("export-packages", i / platforms.length);
              store()._setStepDetail("export-packages", `Exportando ${spec.name} (${i + 1}/${platforms.length})…`);

              try {
                const filename = `${projectName}_${id}.mp4`;
                const writable = createDownloadStream(filename, "video/mp4");

                const videoSettings = {
                  format: "mp4" as const,
                  codec: "h264" as const,
                  width: spec.width,
                  height: spec.height,
                  frameRate: spec.frameRate,
                  bitrate: spec.encoding.bitrate,
                };

                const generator = exportEngine.exportVideo(proj, videoSettings, writable);
                while (true) {
                  const { done } = await generator.next();
                  if (done) break;
                }
                await writable.close();
                exported.push(spec.name);
              } catch (e) {
                failed.push(`${spec.name}: ${errMsg(e)}`);
              }
            }

            setProgress("export-packages", 1.0);

            if (exported.length > 0 && failed.length === 0) {
              setDone(
                "export-packages",
                `✅ Descargados: ${exported.join(", ")}`,
              );
            } else if (exported.length > 0) {
              setDone(
                "export-packages",
                `Descargados: ${exported.join(", ")}. Fallidos: ${failed.join("; ")}`,
              );
            } else {
              setError("export-packages", `No se pudo exportar: ${failed.join("; ")}`);
            }
          }
        }
      } catch (e) {
        setError("export-packages", errMsg(e));
      }
    } else {
      setSkipped("export-packages");
    }

    // ── Finish ────────────────────────────────────────────────────────────────
    // Only "error" status counts as failure — "skipped" is an expected outcome
    const hasErrors = store().steps.some((s) => s.status === "error");
    const doneCount = store().steps.filter((s) => s.status === "done").length;
    const skippedCount = store().steps.filter((s) => s.status === "skipped").length;
    store()._finishPipeline(hasErrors ? "error" : "done");

    if (!hasErrors) {
      toast.success(
        "¡Pipeline completado! 🎉",
        `${doneCount} paso${doneCount !== 1 ? "s" : ""} completado${doneCount !== 1 ? "s" : ""}${skippedCount > 0 ? `, ${skippedCount} omitido${skippedCount !== 1 ? "s" : ""}` : ""}.`,
      );
    } else {
      toast.warning(
        "Pipeline con advertencias",
        "Algunos pasos fallaron. Revisa los detalles en el panel.",
      );
    }
  } catch (e) {
    store()._finishPipeline("error");
    toast.error("Error en el pipeline", errMsg(e));
  } finally {
    try {
      audioCtx.close();
    } catch {
      /* noop */
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────

function finishAborted() {
  store()._finishPipeline("aborted");
  toast.info("Pipeline cancelado", "El proceso fue detenido.");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getFirstAudioClip(): Record<string, unknown> | null {
  const proj = project();
  const tracks = (proj?.timeline?.tracks ?? []) as unknown as Array<{ clips?: Array<Record<string, unknown>> }>;
  for (const track of tracks) {
    for (const clip of track.clips ?? []) {
      if (clip["src"] || clip["mediaId"] || clip["url"]) return clip;
    }
  }
  return null;
}

async function getFirstAudioBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
  const clip = getFirstAudioClip();
  if (!clip) return null;
  try {
    return await decodeClipAudio(clip, ctx);
  } catch {
    return null;
  }
}

async function decodeClipAudio(clip: Record<string, unknown>, ctx: AudioContext): Promise<AudioBuffer> {
  const src = (clip["src"] ?? clip["url"] ?? "") as string;
  if (!src) throw new Error("No clip source URL");
  const res = await fetch(src);
  const arr = await res.arrayBuffer();
  return ctx.decodeAudioData(arr);
}

function monoMix(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += ch[i];
  }
  if (buffer.numberOfChannels > 1) {
    const inv = 1 / buffer.numberOfChannels;
    for (let i = 0; i < len; i++) mono[i] *= inv;
  }
  return mono;
}

function sliceBuffer(
  buf: AudioBuffer,
  startSec: number,
  endSec: number,
  ctx: AudioContext,
): AudioBuffer {
  const startSample = Math.floor(startSec * buf.sampleRate);
  const endSample = Math.min(Math.floor(endSec * buf.sampleRate), buf.length);
  const len = endSample - startSample;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    out.getChannelData(c).set(src.subarray(startSample, endSample));
  }
  return out;
}
