/**
 * Magic Pipeline Store
 *
 * Ephemeral Zustand store for the one-click "Publicar en Redes" pipeline.
 * No persist middleware — state resets on page reload intentionally.
 */
import { create } from "zustand";
import type { SocialPlatformId } from "@openreel/core";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type PipelineStepId =
  | "stem-separation"
  | "audio-enhancement"
  | "filler-removal"
  | "silence-trimming"
  | "transcription"
  | "subtitles"
  | "export-packages"
  | "reels-cutting"
  | "thumbnail-generation";

export type PipelineStepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "error";

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  description: string;
  emoji: string;
  status: PipelineStepStatus;
  progress: number; // 0–100
  error: string | null;
  detail: string | null;
  requiresApiKey: boolean;
  enabled: boolean;
}

export type PipelineStatus = "idle" | "running" | "done" | "error" | "aborted";

export interface PipelineConfig {
  language: string;
  exportPlatforms: SocialPlatformId[];
  reelsDuration: number;
  reelsCount: number;
  thumbnailStyle: string;
  skipStepsIfNoApiKey: boolean;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  language: "es",
  exportPlatforms: ["youtube", "tiktok", "instagram-reels", "linkedin"],
  reelsDuration: 60,
  reelsCount: 3,
  thumbnailStyle: "professional, vibrant, high contrast, cinematic",
  skipStepsIfNoApiKey: true,
};

// ──────────────────────────────────────────────────────────────────────────────
// Default steps definition
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_STEPS: PipelineStep[] = [
  {
    id: "stem-separation",
    label: "Separación de audio",
    description: "Separa voz del fondo musical con HPSS",
    emoji: "🎤",
    status: "pending",
    progress: 0,
    error: null,
    detail: null,
    requiresApiKey: false,
    enabled: true,
  },
  {
    id: "audio-enhancement",
    label: "Mejora de audio",
    description: "Supresión de ruido + EQ + Compresor",
    emoji: "🎚️",
    status: "pending",
    progress: 0,
    error: null,
    detail: null,
    requiresApiKey: false,
    enabled: true,
  },
  {
    id: "silence-trimming",
    label: "Corte de silencios",
    description: "Elimina pausas largas automáticamente",
    emoji: "✂️",
    status: "pending",
    progress: 0,
    error: null,
    detail: null,
    requiresApiKey: false,
    enabled: true,
  },
  {
    id: "transcription",
    label: "Transcripción",
    description: "Whisper local — sin enviar audio a la nube",
    emoji: "📝",
    status: "pending",
    progress: 0,
    error: null,
    detail: null,
    requiresApiKey: false,
    enabled: true,
  },
  {
    id: "filler-removal",
    label: "Eliminación de muletillas",
    description: "Detecta y elimina eh, o sea, digamos…",
    emoji: "🗑️",
    status: "pending",
    progress: 0,
    error: null,
    detail: null,
    requiresApiKey: false,
    enabled: true,
  },
  {
    id: "subtitles",
    label: "Subtítulos",
    description: "Genera subtítulos desde la transcripción",
    emoji: "💬",
    status: "pending",
    progress: 0,
    error: null,
    detail: null,
    requiresApiKey: false,
    enabled: true,
  },
  {
    id: "reels-cutting",
    label: "Reels automáticos",
    description: "Corta los mejores 60 s para TikTok / Reels / Shorts",
    emoji: "🎬",
    status: "pending",
    progress: 0,
    error: null,
    detail: null,
    requiresApiKey: false,
    enabled: true,
  },
  {
    id: "thumbnail-generation",
    label: "Miniatura YouTube",
    description: "Genera una miniatura con IA (OpenRouter)",
    emoji: "🖼️",
    status: "pending",
    progress: 0,
    error: null,
    detail: null,
    requiresApiKey: true,
    enabled: true,
  },
  {
    id: "export-packages",
    label: "Exportar para redes",
    description: "YouTube · LinkedIn · TikTok · Instagram · Twitter",
    emoji: "🚀",
    status: "pending",
    progress: 0,
    error: null,
    detail: null,
    requiresApiKey: false,
    enabled: true,
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────────

interface MagicPipelineState {
  isOpen: boolean;
  status: PipelineStatus;
  steps: PipelineStep[];
  config: PipelineConfig;
  /** Thumbnail data URL produced in the thumbnail step */
  thumbnailDataUrl: string | null;
  /** Reels cut results */
  reelsCuts: Array<{ title: string; startTime: number; endTime: number; score: number }>;
  /** Set to true by runPipeline to signal abort */
  _abortSignal: boolean;

  // Actions
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  toggleStep: (id: PipelineStepId) => void;
  updateConfig: (patch: Partial<PipelineConfig>) => void;
  resetPipeline: () => void;

  // Called by magic-pipeline-runner
  _startPipeline: () => void;
  _setStepStatus: (id: PipelineStepId, status: PipelineStepStatus, detail?: string | null) => void;
  _setStepDetail: (id: PipelineStepId, detail: string) => void;
  _setStepProgress: (id: PipelineStepId, progress: number) => void;
  _setStepError: (id: PipelineStepId, error: string) => void;
  _finishPipeline: (status: PipelineStatus) => void;
  _setThumbnail: (dataUrl: string) => void;
  _setReelsCuts: (cuts: MagicPipelineState["reelsCuts"]) => void;
  _abort: () => void;
}

export const useMagicPipelineStore = create<MagicPipelineState>((set, get) => ({
  isOpen: false,
  status: "idle",
  steps: DEFAULT_STEPS.map((s) => ({ ...s })),
  config: { ...DEFAULT_PIPELINE_CONFIG },
  thumbnailDataUrl: null,
  reelsCuts: [],
  _abortSignal: false,

  openPanel: () => set({ isOpen: true }),
  closePanel: () => set({ isOpen: false }),
  togglePanel: () => set((s) => ({ isOpen: !s.isOpen })),

  toggleStep: (id) =>
    set((s) => ({
      steps: s.steps.map((step) =>
        step.id === id ? { ...step, enabled: !step.enabled } : step,
      ),
    })),

  updateConfig: (patch) =>
    set((s) => ({ config: { ...s.config, ...patch } })),

  resetPipeline: () =>
    set({
      status: "idle",
      steps: DEFAULT_STEPS.map((s) => ({ ...s })),
      thumbnailDataUrl: null,
      reelsCuts: [],
      _abortSignal: false,
    }),

  _startPipeline: () =>
    set({
      status: "running",
      _abortSignal: false,
      thumbnailDataUrl: null,
      reelsCuts: [],
      steps: get().steps.map((s) => ({ ...s, status: "pending", progress: 0, error: null, detail: null })),
    }),

  _setStepStatus: (id, status, detail = null) =>
    set((s) => ({
      steps: s.steps.map((step) =>
        step.id === id ? { ...step, status, detail: detail ?? step.detail } : step,
      ),
    })),

  _setStepDetail: (id, detail) =>
    set((s) => ({
      steps: s.steps.map((step) =>
        step.id === id ? { ...step, detail } : step,
      ),
    })),

  _setStepProgress: (id, progress) =>
    set((s) => ({
      steps: s.steps.map((step) =>
        step.id === id ? { ...step, progress } : step,
      ),
    })),

  _setStepError: (id, error) =>
    set((s) => ({
      steps: s.steps.map((step) =>
        step.id === id ? { ...step, status: "error", error } : step,
      ),
    })),

  _finishPipeline: (status) => set({ status }),

  _setThumbnail: (dataUrl) => set({ thumbnailDataUrl: dataUrl }),

  _setReelsCuts: (cuts) => set({ reelsCuts: cuts }),

  _abort: () => set({ _abortSignal: true }),
}));
