/**
 * WhisperSubtitlePanel
 *
 * Inspector panel for generating subtitles from a selected video/audio clip
 * using Whisper (ONNX) running 100% in the browser via a Web Worker.
 *
 * Usage flow:
 *   1. User selects a clip on the timeline.
 *   2. Opens Inspector → "Auto-subtítulos (IA)" panel.
 *   3. Picks language (default: Español) and model quality.
 *   4. Clicks "Generar subtítulos".
 *   5. Progress bar shows model loading + transcription.
 *   6. Preview of generated subtitles is shown.
 *   7. "Agregar al timeline" applies them to the project.
 *
 * Integration points:
 *   - LocalWhisperEngine (packages/core/src/audio/whisper)
 *   - whisper.worker.ts   (apps/web/src/workers)
 *   - project-store  addSubtitle / applySubtitleStylePreset
 *   - ui-store       getSelectedClipIds
 */

import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from "react";
import {
  Sparkles,
  AlertCircle,
  ChevronDown,
  Check,
  Loader2,
  FileText,
  Trash2,
} from "lucide-react";
import {
  LocalWhisperEngine,
  WHISPER_MODELS,
  WHISPER_LANGUAGES,
  type WhisperProgress,
  type WhisperModelKey,
} from "@openreel/core";
import type { Subtitle } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_OPTIONS: { value: WhisperModelKey; label: string; badge: string }[] = [
  { value: "tiny", label: "Tiny (39 MB)", badge: "rápido" },
  { value: "small", label: "Small (150 MB)", badge: "equilibrado" },
  { value: "medium", label: "Medium (450 MB)", badge: "preciso" },
  { value: "large-v3-turbo", label: "Large Turbo (800 MB)", badge: "mejor" },
];

const ANIMATION_OPTIONS = [
  { value: "karaoke", label: "Karaoke" },
  { value: "word-highlight", label: "Resaltado" },
  { value: "word-by-word", label: "Palabra por palabra" },
  { value: "none", label: "Sin animación" },
] as const;

// ---------------------------------------------------------------------------
// Progress bar component
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  progress: WhisperProgress;
}

const PHASE_LABELS: Record<WhisperProgress["phase"], string> = {
  "loading-model": "Cargando modelo",
  "extracting-audio": "Extrayendo audio",
  transcribing: "Transcribiendo",
  processing: "Procesando",
  complete: "Completado",
  error: "Error",
};

function ProgressBar({ progress }: ProgressBarProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-secondary">
          {PHASE_LABELS[progress.phase] ?? progress.phase}
        </span>
        <span className="text-[10px] font-mono text-text-primary">
          {progress.progress}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-background-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${progress.progress}%` }}
        />
      </div>
      <p className="text-[9px] text-text-muted truncate">{progress.message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubtitlePreview component
// ---------------------------------------------------------------------------

interface SubtitlePreviewProps {
  subtitles: Subtitle[];
  onDiscard: () => void;
  onApply: () => void;
}

function SubtitlePreview({ subtitles, onDiscard, onApply }: SubtitlePreviewProps) {
  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1).padStart(4, "0");
    return `${m}:${sec}`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-secondary">
          {subtitles.length} subtítulo{subtitles.length !== 1 ? "s" : ""}{" "}
          generados
        </span>
        <button
          onClick={onDiscard}
          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-red-400 transition-colors"
        >
          <Trash2 size={10} />
          Descartar
        </button>
      </div>

      <div className="max-h-40 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
        {subtitles.map((sub) => (
          <div
            key={sub.id}
            className="p-2 rounded bg-background-secondary border border-border/50 text-[10px]"
          >
            <span className="font-mono text-text-muted">
              {fmtTime(sub.startTime)} → {fmtTime(sub.endTime)}
            </span>
            <p className="mt-0.5 text-text-primary leading-relaxed">
              {sub.text}
            </p>
          </div>
        ))}
      </div>

      <button
        onClick={onApply}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
      >
        <Check size={14} />
        <span className="text-[11px] font-medium">
          Agregar al timeline
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export const WhisperSubtitlePanel: React.FC = () => {
  // Store hooks
  const getSelectedClipIds = useUIStore((s) => s.getSelectedClipIds);
  const getClip = useProjectStore((s) => s.getClip);
  const getMediaItem = useProjectStore((s) => s.getMediaItem);
  const addSubtitle = useProjectStore((s) => s.addSubtitle);
  const applySubtitleStylePreset = useProjectStore(
    (s) => s.applySubtitleStylePreset,
  );

  // Local state
  const [language, setLanguage] = useState("es");
  const [model, setModel] = useState<WhisperModelKey>("tiny");
  const [animStyle, setAnimStyle] = useState<
    "karaoke" | "word-highlight" | "word-by-word" | "none"
  >("karaoke");
  const [subtitleStyle, setSubtitleStyle] = useState("default");

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<WhisperProgress | null>(null);
  const [result, setResult] = useState<Subtitle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Engine ref – lazily created, persists across renders
  const engineRef = useRef<LocalWhisperEngine | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
    };
  }, []);

  // Resolve selected clip
  const selectedClipId = useMemo(() => {
    const ids = getSelectedClipIds();
    return ids.length === 1 ? ids[0] : null;
  }, [getSelectedClipIds]);

  const selectedClip = useMemo(
    () => (selectedClipId ? getClip(selectedClipId) : null),
    [selectedClipId, getClip],
  );

  const mediaItem = useMemo(
    () =>
      selectedClip?.mediaId ? getMediaItem(selectedClip.mediaId) : null,
    [selectedClip, getMediaItem],
  );

  const canTranscribe =
    !isRunning && selectedClip != null && mediaItem != null;

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleGenerate = useCallback(async () => {
    if (!selectedClip || !mediaItem) return;

    setError(null);
    setResult(null);
    setIsRunning(true);

    try {
      // Lazily create the engine with the Vite worker URL
      if (!engineRef.current) {
        engineRef.current = new LocalWhisperEngine(
          () =>
            new Worker(
              new URL("../../../workers/whisper.worker.ts", import.meta.url),
              { type: "module" },
            ),
        );
      }

      const subtitles = await engineRef.current.transcribeClip(
        selectedClip,
        mediaItem,
        { language, model, animationStyle: animStyle },
        (p) => setProgress(p),
      );

      setResult(subtitles);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error desconocido en la transcripción",
      );
    } finally {
      setIsRunning(false);
    }
  }, [selectedClip, mediaItem, language, model, animStyle]);

  const handleApply = useCallback(async () => {
    if (!result) return;

    result.forEach((sub) => addSubtitle(sub));

    if (subtitleStyle !== "default") {
      await applySubtitleStylePreset(subtitleStyle);
    }

    setResult(null);
    setProgress(null);
  }, [result, addSubtitle, applySubtitleStylePreset, subtitleStyle]);

  const handleDiscard = useCallback(() => {
    setResult(null);
    setProgress(null);
    setError(null);
  }, []);

  // -------------------------------------------------------------------------
  // Render: no clip selected
  // -------------------------------------------------------------------------

  if (!selectedClip) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 p-3 bg-background-tertiary rounded-lg border border-border/40">
          <FileText size={14} className="text-text-muted shrink-0" />
          <p className="text-[10px] text-text-muted leading-relaxed">
            Selecciona un clip de video o audio en el timeline para generar
            subtítulos automáticamente.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: main UI
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Sparkles size={15} className="text-primary shrink-0" />
        <div>
          <span className="text-[11px] font-medium text-text-primary">
            Auto-subtítulos IA
          </span>
          <p className="text-[9px] text-text-muted">
            Whisper ONNX · 100% local · sin internet
          </p>
        </div>
      </div>

      {/* Config */}
      {!isRunning && !result && (
        <div className="space-y-3 p-3 bg-background-tertiary rounded-lg">
          {/* Language */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-secondary shrink-0">
              Idioma
            </span>
            <Select
              value={language}
              onValueChange={setLanguage}
              disabled={isRunning}
            >
              <SelectTrigger className="w-auto min-w-[120px] bg-background-secondary border-border text-text-primary text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background-secondary border-border max-h-60">
                {WHISPER_LANGUAGES.map((lang) => (
                  <SelectItem
                    key={lang.code}
                    value={lang.code}
                    className="text-[10px]"
                  >
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-secondary shrink-0">
              Modelo
            </span>
            <Select
              value={model}
              onValueChange={(v) => setModel(v as WhisperModelKey)}
              disabled={isRunning}
            >
              <SelectTrigger className="w-auto min-w-[140px] bg-background-secondary border-border text-text-primary text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background-secondary border-border">
                {MODEL_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="text-[10px]"
                  >
                    <span>{opt.label}</span>
                    <span className="ml-2 text-text-muted">· {opt.badge}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Animation style */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-secondary shrink-0">
              Animación
            </span>
            <Select
              value={animStyle}
              onValueChange={(v) =>
                setAnimStyle(
                  v as "karaoke" | "word-highlight" | "word-by-word" | "none",
                )
              }
              disabled={isRunning}
            >
              <SelectTrigger className="w-auto min-w-[120px] bg-background-secondary border-border text-text-primary text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background-secondary border-border">
                {ANIMATION_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="text-[10px]"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Caption visual style */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-secondary shrink-0">
              Estilo visual
            </span>
            <Select
              value={subtitleStyle}
              onValueChange={setSubtitleStyle}
              disabled={isRunning}
            >
              <SelectTrigger className="w-auto min-w-[100px] bg-background-secondary border-border text-text-primary text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background-secondary border-border">
                {["default", "modern", "bold", "cinematic", "minimal"].map(
                  (s) => (
                    <SelectItem key={s} value={s} className="text-[10px] capitalize">
                      {s}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <span className="text-[10px] text-red-400 leading-relaxed">
            {error}
          </span>
        </div>
      )}

      {/* Running: progress */}
      {isRunning && progress && (
        <div className="p-3 bg-background-tertiary rounded-lg">
          <ProgressBar progress={progress} />
        </div>
      )}

      {/* Result preview */}
      {result && !isRunning && (
        <SubtitlePreview
          subtitles={result}
          onApply={handleApply}
          onDiscard={handleDiscard}
        />
      )}

      {/* Generate button */}
      {!isRunning && !result && (
        <>
          <button
            onClick={handleGenerate}
            disabled={!canTranscribe}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5
                       bg-primary text-white rounded-lg
                       hover:bg-primary/80 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles size={15} />
            <span className="text-[11px] font-medium">
              Generar subtítulos
            </span>
          </button>

          <p className="text-[9px] text-text-muted text-center leading-relaxed">
            El modelo se descarga la primera vez (~{WHISPER_MODELS[model].sizeMB} MB)
            y queda guardado en el navegador.
          </p>
        </>
      )}

      {/* Cancel button while running */}
      {isRunning && (
        <button
          onClick={() => {
            engineRef.current?.dispose();
            engineRef.current = null;
            setIsRunning(false);
            setProgress(null);
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2
                     border border-border text-text-secondary rounded-lg
                     hover:border-red-500/50 hover:text-red-400 transition-colors"
        >
          <Loader2 size={13} className="animate-spin" />
          <span className="text-[11px]">Cancelar</span>
        </button>
      )}
    </div>
  );
};

export default WhisperSubtitlePanel;
