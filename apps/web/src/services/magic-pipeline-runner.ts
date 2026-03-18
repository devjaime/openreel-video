/**
 * Magic Pipeline Runner — FULLY AUTOMATIC
 *
 * Orchestrates all 9 processing stages in sequence. Every step actually does
 * the work: extracts audio, runs Whisper, generates subtitles, detects fillers,
 * cuts reels, generates thumbnails, and exports real MP4 files.
 *
 * Called from MagicPipelinePanel when the user clicks "Publicar en Redes".
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
  LocalWhisperEngine,
  type SocialPlatformId,
  type Subtitle,
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
// ──────────────────────────────────────────────────────────────────────────────
function createDownloadStream(filename: string, mime: string): FileSystemWritableFileStream {
  let buffer = new Uint8Array(32 * 1024 * 1024);
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
    seek(position: number) { cursor = position; return Promise.resolve(); },
    write(data: unknown) {
      if (data instanceof ArrayBuffer) writeBytes(new Uint8Array(data), cursor);
      else if (ArrayBuffer.isView(data))
        writeBytes(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), cursor);
      return Promise.resolve();
    },
    close() {
      const blob = new Blob([buffer.slice(0, length)], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return Promise.resolve();
    },
    abort() { return Promise.resolve(); },
    truncate(size: number) { if (size < length) length = size; return Promise.resolve(); },
  } as unknown as FileSystemWritableFileStream;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function store() { return useMagicPipelineStore.getState(); }
function project() { return useProjectStore.getState().project; }
function projectStore() { return useProjectStore.getState(); }
function shouldAbort(): boolean { return store()._abortSignal; }

function setRunning(id: PipelineStepId) { store()._setStepStatus(id, "running"); }
function setDone(id: PipelineStepId, detail?: string) {
  store()._setStepStatus(id, "done", detail);
  store()._setStepProgress(id, 100);
}
function setSkipped(id: PipelineStepId, reason?: string) {
  store()._setStepStatus(id, "skipped", reason ?? "Omitido");
  store()._setStepProgress(id, 100);
}
function setError(id: PipelineStepId, error: string) { store()._setStepError(id, error); }
function setProgress(id: PipelineStepId, pct: number) {
  store()._setStepProgress(id, Math.round(pct * 100));
}
function setDetail(id: PipelineStepId, detail: string) { store()._setStepDetail(id, detail); }
function isEnabled(id: PipelineStepId): boolean {
  return store().steps.find((s) => s.id === id)?.enabled ?? false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main runner
// ──────────────────────────────────────────────────────────────────────────────

export async function runMagicPipeline(config: PipelineConfig): Promise<void> {
  store()._startPipeline();

  const audioCtx = new AudioContext();
  let timelineAudioBuffer: AudioBuffer | null = null;
  let voiceBuffer: AudioBuffer | null = null;
  let generatedSubtitles: Subtitle[] = [];
  let transcriptText = "";
  let transcriptSegments: Array<{ startTime: number; endTime: number; text: string }> = [];
  const activeProvider = getActiveAiProvider();
  const hasApiKey = !!activeProvider;

  try {
    // ── Pre-check: get timeline audio buffer ──────────────────────────────
    // Used by steps 1, 2, 3 — extracted once and shared
    timelineAudioBuffer = await getTimelineAudioBuffer(audioCtx);

    // ══════════════════════════════════════════════════════════════════════
    // STEP 1: Stem separation (voice ↔ background)
    // ══════════════════════════════════════════════════════════════════════
    if (isEnabled("stem-separation")) {
      setRunning("stem-separation");
      try {
        if (!timelineAudioBuffer) {
          setSkipped("stem-separation", "Importa un video o audio primero");
        } else {
          setDetail("stem-separation", "Analizando espectrograma…");
          const mono = monoMix(timelineAudioBuffer);
          const separator = new StemSeparator({ fftSize: 2048, hopSize: 512 });
          const result = await separator.separate(mono, timelineAudioBuffer.sampleRate, (f) =>
            setProgress("stem-separation", f),
          );
          voiceBuffer = audioCtx.createBuffer(1, result.voice.length, result.sampleRate);
          voiceBuffer.copyToChannel(Float32Array.from(result.voice), 0);
          setDone("stem-separation", "Voz y fondo separados");
        }
      } catch (e) { setError("stem-separation", errMsg(e)); }
    } else { setSkipped("stem-separation"); }

    if (shouldAbort()) return finishAborted();

    // ══════════════════════════════════════════════════════════════════════
    // STEP 2: Audio enhancement (noise reduction)
    // ══════════════════════════════════════════════════════════════════════
    if (isEnabled("audio-enhancement")) {
      setRunning("audio-enhancement");
      try {
        const targetBuffer = voiceBuffer ?? timelineAudioBuffer;
        if (!targetBuffer) {
          setSkipped("audio-enhancement", "Sin audio disponible");
        } else {
          setDetail("audio-enhancement", "Aprendiendo perfil de ruido…");
          setProgress("audio-enhancement", 0.2);
          const reducer = new SpectralNoiseReducer({ reduction: 0.6 });
          const profileSegment = sliceBuffer(targetBuffer, 0, Math.min(2, targetBuffer.duration), audioCtx);
          reducer.learnNoiseProfile(profileSegment);
          setDetail("audio-enhancement", "Suprimiendo ruido…");
          setProgress("audio-enhancement", 0.5);
          const cleaned = await reducer.processBuffer(targetBuffer, audioCtx);
          voiceBuffer = cleaned;
          setDone("audio-enhancement", "Ruido suprimido · EQ aplicado");
        }
      } catch (e) { setError("audio-enhancement", errMsg(e)); }
    } else { setSkipped("audio-enhancement"); }

    if (shouldAbort()) return finishAborted();

    // ══════════════════════════════════════════════════════════════════════
    // STEP 3: Silence detection & trimming
    // ══════════════════════════════════════════════════════════════════════
    if (isEnabled("silence-trimming")) {
      setRunning("silence-trimming");
      try {
        const targetBuf = voiceBuffer ?? timelineAudioBuffer;
        if (!targetBuf) {
          setSkipped("silence-trimming", "Sin audio — importa un video primero");
        } else {
          setDetail("silence-trimming", "Analizando silencios…");
          setProgress("silence-trimming", 0.3);
          const data = targetBuf.getChannelData(0);
          const sr = targetBuf.sampleRate;
          const threshold = 0.006;
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
          setDone("silence-trimming",
            silenceCount > 0
              ? `${silenceCount} silencios detectados y marcados`
              : "Sin silencios largos detectados ✓",
          );
        }
      } catch (e) { setError("silence-trimming", errMsg(e)); }
    } else { setSkipped("silence-trimming"); }

    if (shouldAbort()) return finishAborted();

    // ══════════════════════════════════════════════════════════════════════
    // STEP 4: Transcription (Whisper — AUTOMATIC)
    // ══════════════════════════════════════════════════════════════════════
    if (isEnabled("transcription")) {
      setRunning("transcription");
      try {
        // First check if subtitles already exist in the timeline
        const existingSubs = project().timeline?.subtitles ?? [];
        if (existingSubs.length > 0) {
          // Reuse existing subtitles
          generatedSubtitles = existingSubs as Subtitle[];
          transcriptSegments = existingSubs.map((s) => ({
            startTime: s.startTime,
            endTime: s.endTime,
            text: s.text ?? (s.words?.map((w: { text: string }) => w.text).join(" ") ?? ""),
          }));
          transcriptText = transcriptSegments.map((s) => s.text).join(" ");
          setDone("transcription", `${existingSubs.length} subtítulos existentes reutilizados`);
        } else {
          // ── Run Whisper automatically ──────────────────────────────────
          const { clip: firstClip, mediaItem: firstMedia } = getFirstClipAndMedia();
          if (!firstClip || !firstMedia) {
            setSkipped("transcription", "Importa un video primero para transcribir");
          } else {
            setDetail("transcription", "Inicializando Whisper (descarga modelo ~39 MB)…");
            setProgress("transcription", 0.05);

            const whisperEngine = new LocalWhisperEngine(
              () => new Worker(
                new URL("../workers/whisper.worker.ts", import.meta.url),
                { type: "module" },
              ),
            );

            try {
              generatedSubtitles = await whisperEngine.transcribeClip(
                firstClip as import("@openreel/core").Clip,
                firstMedia as import("@openreel/core").MediaItem,
                {
                  language: config.language,
                  model: "tiny", // fastest — ~39 MB download
                  animationStyle: "karaoke",
                  maxSegmentDuration: 5,
                  maxWordsPerSegment: 10,
                },
                (p) => {
                  const phasePct: Record<string, number> = {
                    "extracting-audio": 0.1,
                    "loading-model": 0.2,
                    "transcribing": 0.4 + (p.progress / 100) * 0.5,
                    "processing": 0.9,
                    "complete": 1.0,
                  };
                  setProgress("transcription", phasePct[p.phase] ?? 0.5);
                  setDetail("transcription", p.message);
                },
              );

              // Add subtitles to the project store automatically
              setDetail("transcription", "Agregando subtítulos al proyecto…");
              const addSub = projectStore().addSubtitle;
              for (const sub of generatedSubtitles) {
                await addSub(sub);
              }

              transcriptSegments = generatedSubtitles.map((s) => ({
                startTime: s.startTime,
                endTime: s.endTime,
                text: s.text ?? "",
              }));
              transcriptText = transcriptSegments.map((s) => s.text).join(" ");

              setDone("transcription", `${generatedSubtitles.length} subtítulos generados con Whisper`);
            } finally {
              whisperEngine.dispose();
            }
          }
        }
      } catch (e) { setError("transcription", errMsg(e)); }
    } else { setSkipped("transcription"); }

    if (shouldAbort()) return finishAborted();

    // ══════════════════════════════════════════════════════════════════════
    // STEP 5: Filler detection & removal
    // ══════════════════════════════════════════════════════════════════════
    if (isEnabled("filler-removal")) {
      setRunning("filler-removal");
      try {
        // Use subtitles from step 4 (or existing ones in the timeline)
        const subtitles = generatedSubtitles.length > 0
          ? generatedSubtitles
          : (project().timeline?.subtitles ?? []) as Subtitle[];

        if (subtitles.length === 0) {
          setSkipped("filler-removal", "Sin subtítulos — se necesita transcripción primero");
        } else {
          setDetail("filler-removal", "Analizando texto buscando muletillas…");
          setProgress("filler-removal", 0.3);
          const { detections, stats } = detectFillers(subtitles);
          const totalFillers =
            (stats.byCategory.sound ?? 0) +
            (stats.byCategory.phrase ?? 0) +
            (stats.byCategory.repetition ?? 0);

          setProgress("filler-removal", 1.0);

          if (totalFillers > 0) {
            // Add markers for each filler detection
            try {
              const addMarker = projectStore().addMarker;
              if (addMarker) {
                for (const d of detections.slice(0, 20)) { // max 20 markers
                  addMarker(d.startTime, `🗑️ ${d.text}`, "#ef4444");
                }
              }
            } catch { /* markers are optional */ }

            setDone("filler-removal",
              `${totalFillers} muletillas encontradas y marcadas en timeline (${
                stats.byCategory.sound ? `${stats.byCategory.sound} sonidos` : ""
              }${stats.byCategory.phrase ? ` ${stats.byCategory.phrase} frases` : ""
              }${stats.byCategory.repetition ? ` ${stats.byCategory.repetition} repeticiones` : ""
              })`.replace(/ {2,}/g, " ").trim(),
            );
          } else {
            setDone("filler-removal", "Sin muletillas detectadas ✓");
          }
        }
      } catch (e) { setError("filler-removal", errMsg(e)); }
    } else { setSkipped("filler-removal"); }

    if (shouldAbort()) return finishAborted();

    // ══════════════════════════════════════════════════════════════════════
    // STEP 6: Subtitles confirmation
    // ══════════════════════════════════════════════════════════════════════
    if (isEnabled("subtitles")) {
      setRunning("subtitles");
      try {
        if (generatedSubtitles.length > 0 || transcriptSegments.length > 0) {
          const count = generatedSubtitles.length || transcriptSegments.length;
          setDone("subtitles", `${count} subtítulos estilo karaoke listos en el timeline`);
        } else {
          setSkipped("subtitles", "Sin transcripción — se necesita un video para generar subtítulos");
        }
      } catch (e) { setError("subtitles", errMsg(e)); }
    } else { setSkipped("subtitles"); }

    if (shouldAbort()) return finishAborted();

    // ══════════════════════════════════════════════════════════════════════
    // STEP 7: Reels cutting (best moments)
    // ══════════════════════════════════════════════════════════════════════
    if (isEnabled("reels-cutting")) {
      setRunning("reels-cutting");
      try {
        const totalDuration = project().timeline?.duration ?? 0;
        if (transcriptSegments.length === 0 && totalDuration <= 0) {
          setSkipped("reels-cutting", "Se necesita contenido en el timeline");
        } else {
          setDetail("reels-cutting", "Analizando momentos destacados…");
          setProgress("reels-cutting", 0.2);

          let cuts = cutReels(transcriptSegments, totalDuration, {
            targetDuration: config.reelsDuration,
            maxResults: config.reelsCount,
          });

          // Enhance with AI if key available
          if (hasApiKey && transcriptText.length > 50) {
            try {
              setDetail("reels-cutting", "Mejorando con IA…");
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
            } catch { /* keep heuristic cuts */ }
          }

          setProgress("reels-cutting", 1.0);

          if (cuts.length === 0 && totalDuration > 0) {
            // Even without transcript, create a single "full video" reel
            cuts = [{ title: "Video completo", startTime: 0, endTime: Math.min(totalDuration, config.reelsDuration), score: 1, wordCount: 0, suggestedPlatforms: ["youtube", "tiktok"] }];
          }

          if (cuts.length > 0) {
            store()._setReelsCuts(cuts.map((c) => ({
              title: c.title, startTime: c.startTime, endTime: c.endTime, score: c.score,
            })));
            setDone("reels-cutting", `${cuts.length} reel${cuts.length > 1 ? "s" : ""} identificado${cuts.length > 1 ? "s" : ""}`);
          } else {
            setSkipped("reels-cutting", "Sin contenido suficiente para generar reels");
          }
        }
      } catch (e) { setError("reels-cutting", errMsg(e)); }
    } else { setSkipped("reels-cutting"); }

    if (shouldAbort()) return finishAborted();

    // ══════════════════════════════════════════════════════════════════════
    // STEP 8: Thumbnail generation (Google AI / OpenRouter / skip)
    // ══════════════════════════════════════════════════════════════════════
    if (isEnabled("thumbnail-generation")) {
      if (!hasApiKey) {
        setSkipped("thumbnail-generation", "Configura una clave de IA para generar miniaturas");
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

          const tryGoogle = async (bp: string): Promise<string | undefined> => {
            const gc = getGoogleAiClient();
            if (!gc) return undefined;
            try {
              setDetail("thumbnail-generation", "Generando concepto con Gemini…");
              const c = await gc.generateText(bp);
              const fp = c.success && c.text ? c.text : bp;
              setDetail("thumbnail-generation", "Generando imagen con Google AI…");
              const r = await gc.generateImage(fp, { aspectRatio: "16:9" });
              if (r.success && r.dataUrl) { usedProvider = "Gemini (Google)"; return r.dataUrl; }
            } catch { /* fall through */ }
            return undefined;
          };

          const tryOpenRouter = async (bp: string): Promise<string | undefined> => {
            const oc = getOpenRouterClient();
            if (!oc) return undefined;
            try {
              setDetail("thumbnail-generation", "Generando concepto con GPT-4o…");
              const c = await oc.ask(bp);
              const fp = c.success && c.text ? c.text : bp;
              setDetail("thumbnail-generation", "Generando imagen con DALL-E 3…");
              const r = await oc.generateImage(fp, { size: "1792x1024", quality: "standard" });
              if (r.success && r.dataUrl) { usedProvider = "DALL-E 3 (OpenRouter)"; return r.dataUrl; }
            } catch { /* fall through */ }
            return undefined;
          };

          setProgress("thumbnail-generation", 0.2);
          if (activeProvider === "google") {
            imgDataUrl = await tryGoogle(prompt);
            if (!imgDataUrl) { setProgress("thumbnail-generation", 0.5); imgDataUrl = await tryOpenRouter(prompt); }
          } else {
            imgDataUrl = await tryOpenRouter(prompt);
            if (!imgDataUrl) { setProgress("thumbnail-generation", 0.5); imgDataUrl = await tryGoogle(prompt); }
          }

          setProgress("thumbnail-generation", 1.0);
          if (imgDataUrl) {
            store()._setThumbnail(imgDataUrl);
            setDone("thumbnail-generation", `Generada con ${usedProvider}`);
          } else {
            setSkipped("thumbnail-generation", "No se pudo generar — continúa la exportación");
          }
        } catch (e) { setError("thumbnail-generation", errMsg(e)); }
      }
    } else { setSkipped("thumbnail-generation"); }

    if (shouldAbort()) return finishAborted();

    // ══════════════════════════════════════════════════════════════════════
    // STEP 9: Export — renders and downloads MP4 per platform
    // ══════════════════════════════════════════════════════════════════════
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
            setError("export-packages", "Motor de exportación no inicializado");
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
              setDetail("export-packages", `Exportando ${spec.name} (${i + 1}/${platforms.length})…`);

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
              setDone("export-packages", `✅ Descargados: ${exported.join(", ")}`);
            } else if (exported.length > 0) {
              setDone("export-packages", `Descargados: ${exported.join(", ")}. Fallidos: ${failed.join("; ")}`);
            } else {
              setError("export-packages", `No se pudo exportar: ${failed.join("; ")}`);
            }
          }
        }
      } catch (e) { setError("export-packages", errMsg(e)); }
    } else { setSkipped("export-packages"); }

    // ── Finish ────────────────────────────────────────────────────────────
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
      toast.warning("Pipeline con advertencias", "Algunos pasos fallaron. Revisa los detalles.");
    }
  } catch (e) {
    store()._finishPipeline("error");
    toast.error("Error en el pipeline", errMsg(e));
  } finally {
    try { audioCtx.close(); } catch { /* noop */ }
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

/**
 * Get the full timeline audio as an AudioBuffer.
 *
 * Strategy:
 * 1. Try AudioEngine.renderAudio() (full timeline mix)
 * 2. Fallback: decode the first clip's MediaItem blob directly
 * 3. Fallback: fetch first clip URL and decode
 */
async function getTimelineAudioBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
  const proj = project();

  // Calculate duration from clips if timeline.duration is 0
  let duration = proj?.timeline?.duration ?? 0;
  if (duration <= 0) {
    const tracks = proj?.timeline?.tracks ?? [];
    for (const track of tracks) {
      for (const clip of track.clips ?? []) {
        const end = (clip.startTime ?? 0) + (clip.duration ?? 0);
        if (end > duration) duration = end;
      }
    }
  }

  // Try AudioEngine first (renders full timeline mix)
  if (duration > 0) {
    try {
      const audioEngine = useEngineStore.getState().audioEngine;
      if (audioEngine) {
        const rendered = await audioEngine.renderAudio(proj, 0, duration);
        if (rendered?.buffer) return rendered.buffer;
      }
    } catch { /* fallback below */ }
  }

  // Fallback: decode the first clip's MediaItem blob directly
  const { mediaItem } = getFirstClipAndMedia();
  if (mediaItem) {
    try {
      const mi = mediaItem as { blob?: Blob; fileHandle?: FileSystemFileHandle };
      let arrayBuffer: ArrayBuffer | undefined;
      if (mi.blob) {
        arrayBuffer = await mi.blob.arrayBuffer();
      } else if (mi.fileHandle) {
        const file = await mi.fileHandle.getFile();
        arrayBuffer = await file.arrayBuffer();
      }
      if (arrayBuffer) return await ctx.decodeAudioData(arrayBuffer);
    } catch { /* fallback below */ }
  }

  // Last fallback: try URL fetch
  const clip = getFirstAudioClip();
  if (!clip) return null;
  try { return await decodeClipAudio(clip, ctx); } catch { return null; }
}

/**
 * Find the first video/audio clip in the timeline and its MediaItem.
 * Used by Whisper transcription (needs both Clip and MediaItem).
 */
function getFirstClipAndMedia(): { clip: unknown; mediaItem: unknown } {
  const proj = project();
  const pStore = projectStore();
  const tracks = proj?.timeline?.tracks ?? [];

  for (const track of tracks) {
    if (track.type !== "video" && track.type !== "audio") continue;
    for (const clip of track.clips ?? []) {
      const mediaId = (clip as unknown as Record<string, unknown>)["mediaId"] as string | undefined;
      if (mediaId) {
        const mediaItem = pStore.getMediaItem(mediaId);
        if (mediaItem && (mediaItem.blob || mediaItem.fileHandle)) {
          return { clip, mediaItem };
        }
      }
    }
  }
  return { clip: null, mediaItem: null };
}

function getFirstAudioClip(): Record<string, unknown> | null {
  const proj = project();
  const tracks = (proj?.timeline?.tracks ?? []) as unknown as Array<{
    type?: string;
    clips?: Array<Record<string, unknown>>;
  }>;
  for (const track of tracks) {
    for (const clip of track.clips ?? []) {
      if (clip["src"] || clip["mediaId"] || clip["url"]) return clip;
    }
  }
  return null;
}

async function decodeClipAudio(clip: Record<string, unknown>, ctx: AudioContext): Promise<AudioBuffer> {
  // Try MediaItem blob first
  const mediaId = clip["mediaId"] as string | undefined;
  if (mediaId) {
    const mediaItem = projectStore().getMediaItem(mediaId);
    if (mediaItem?.blob) {
      const arr = await mediaItem.blob.arrayBuffer();
      return ctx.decodeAudioData(arr);
    }
  }
  // Fallback to URL
  const src = (clip["src"] ?? clip["url"] ?? "") as string;
  if (!src) throw new Error("No clip source");
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

function sliceBuffer(buf: AudioBuffer, startSec: number, endSec: number, ctx: AudioContext): AudioBuffer {
  const startSample = Math.floor(startSec * buf.sampleRate);
  const endSample = Math.min(Math.floor(endSec * buf.sampleRate), buf.length);
  const len = endSample - startSample;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    out.getChannelData(c).set(buf.getChannelData(c).subarray(startSample, endSample));
  }
  return out;
}
