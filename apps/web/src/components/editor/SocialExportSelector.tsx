/**
 * SocialExportSelector
 *
 * "Exportar para…" panel integrated into the ExportDialog.
 *
 * Layout:
 *  ┌────────────────────────────────────────────────────────┐
 *  │  [Platform grid — 3-col card list]                     │
 *  ├──────────────────────┬─────────────────────────────────┤
 *  │  Safe-area preview   │  Spec summary + tips + actions  │
 *  └──────────────────────┴─────────────────────────────────┘
 *
 * Callbacks:
 *   onApply(settings) — user clicks "Exportar" with this platform's settings
 *   onAdaptCanvas(w, h, fps) — user clicks "Adaptar canvas" to resize the project
 */

import React, { useState, useMemo } from "react";
import {
  Sparkles,
  CheckCircle2,
  Info,
  RefreshCw,
  Clock,
  HardDrive,
  Subtitles,
  Video,
  AlertTriangle,
} from "lucide-react";
import {
  getAllSocialPlatforms,
  type SocialPlatformSpec,
  type SocialPlatformId,
} from "@openreel/core";
import type { VideoExportSettings } from "@openreel/core";
import { SafeAreaOverlay } from "./SafeAreaOverlay";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface SocialExportSelectorProps {
  /** Called when the user confirms export for a platform */
  onApply: (settings: VideoExportSettings) => void;
  /** Called when the user wants to resize the project canvas */
  onAdaptCanvas: (width: number, height: number, frameRate: number) => void;
  /** Current project canvas size — used to warn about mismatches */
  projectWidth: number;
  projectHeight: number;
  /** Video duration in seconds — for constraint warnings */
  duration?: number;
  /** Pre-select a platform by id */
  initialPlatformId?: SocialPlatformId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function specToExportSettings(spec: SocialPlatformSpec): VideoExportSettings {
  return {
    format: "mp4",
    codec: spec.encoding.codec,
    width: spec.width,
    height: spec.height,
    frameRate: spec.frameRate,
    bitrate: spec.encoding.bitrate,
    bitrateMode: spec.encoding.bitrateMode,
    quality: 85,
    keyframeInterval: spec.encoding.keyframeInterval,
    audioSettings: {
      format: "aac",
      sampleRate: spec.encoding.audioSampleRate,
      bitDepth: 16,
      bitrate: spec.encoding.audioBitrate,
      channels: 2,
    },
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

function formatDur(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function estimatedSize(bitrate: number, dur: number): string {
  const mb = (bitrate * 1000 * dur) / 8 / (1024 * 1024);
  return `~${mb.toFixed(0)} MB`;
}

// ─────────────────────────────────────────────────────────────────────────────
// AspectRatio mini-thumbnail (pure CSS)
// ─────────────────────────────────────────────────────────────────────────────

const AspectRatioPill: React.FC<{ ratio: string; selected: boolean }> = ({
  ratio,
  selected,
}) => (
  <span
    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-medium ${
      selected
        ? "bg-primary/20 text-primary"
        : "bg-background-secondary text-text-muted"
    }`}
  >
    {ratio}
  </span>
);

// ─────────────────────────────────────────────────────────────────────────────
// Platform card (left grid)
// ─────────────────────────────────────────────────────────────────────────────

const PlatformCard: React.FC<{
  spec: SocialPlatformSpec;
  selected: boolean;
  hasCanvasMismatch: boolean;
  onClick: () => void;
}> = ({ spec, selected, hasCanvasMismatch, onClick }) => {
  const isVertical = spec.height > spec.width;
  const isSquare = spec.width === spec.height;
  const thumbW = isSquare ? 28 : isVertical ? 20 : 36;
  const thumbH = isSquare ? 28 : isVertical ? 36 : 22;

  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
        selected
          ? "border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.3)]"
          : "border-border hover:border-primary/40 hover:bg-background-tertiary"
      }`}
    >
      {/* Aspect ratio thumbnail */}
      <div
        className={`shrink-0 rounded-sm border ${
          selected ? "border-primary/50" : "border-border"
        } bg-background-secondary flex items-center justify-center`}
        style={{ width: thumbW, height: thumbH }}
      >
        <span className="text-[10px]">{spec.emoji}</span>
      </div>

      {/* Platform info */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-text-primary leading-tight truncate">
          {spec.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <AspectRatioPill ratio={spec.aspectRatio} selected={selected} />
          <span className="text-[9px] text-text-muted">
            {spec.frameRate}fps
          </span>
        </div>
      </div>

      {/* Mismatch indicator */}
      {hasCanvasMismatch && (
        <AlertTriangle size={10} className="text-yellow-500 shrink-0" />
      )}

      {selected && (
        <CheckCircle2 size={13} className="text-primary shrink-0" />
      )}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Safe-area preview (right panel, top)
// ─────────────────────────────────────────────────────────────────────────────

const SafeAreaPreview: React.FC<{ spec: SocialPlatformSpec }> = ({ spec }) => {
  const isVertical = spec.height > spec.width;
  const isSquare = spec.width === spec.height;

  // Scale preview box to fixed area
  const PREVIEW_W = isVertical ? 100 : isSquare ? 130 : 200;
  const PREVIEW_H = isVertical
    ? Math.round((PREVIEW_W * spec.height) / spec.width)
    : isSquare
      ? 130
      : Math.round((PREVIEW_W * spec.height) / spec.width);

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[9px] text-text-muted uppercase tracking-wide">
        Zona segura
      </p>

      {/* Preview frame */}
      <div
        className="relative rounded border border-border bg-background-secondary overflow-hidden"
        style={{ width: PREVIEW_W, height: PREVIEW_H }}
      >
        {/* Gradient bg to simulate content */}
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at center, ${spec.color}22 0%, transparent 70%)`,
          }}
        />
        {/* Grid lines */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-1/3 left-0 right-0 h-px bg-white" />
          <div className="absolute top-2/3 left-0 right-0 h-px bg-white" />
          <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white" />
          <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white" />
        </div>

        {/* SafeAreaOverlay — scaled to preview size */}
        <SafeAreaOverlay
          spec={spec}
          visible
          showSubtitleGuide
          showToggle={false}
          uiZoneOpacity={0.65}
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[9px] text-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-green-500 opacity-80 rounded" />
          Safe zone
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-blue-400 opacity-80 rounded" />
          Subtítulos
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-1.5 opacity-50 rounded"
            style={{ background: "rgba(239,68,68,0.5)" }}
          />
          UI plataforma
        </span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Constraint chip
// ─────────────────────────────────────────────────────────────────────────────

const Chip: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  warn?: boolean;
}> = ({ icon, label, value, warn = false }) => (
  <div
    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${
      warn
        ? "border-yellow-500/40 bg-yellow-500/10"
        : "border-border bg-background-tertiary"
    }`}
  >
    <span className={warn ? "text-yellow-500" : "text-text-muted"}>{icon}</span>
    <div>
      <p className="text-[9px] text-text-muted leading-none">{label}</p>
      <p
        className={`text-[11px] font-semibold leading-tight ${
          warn ? "text-yellow-400" : "text-text-primary"
        }`}
      >
        {value}
      </p>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export const SocialExportSelector: React.FC<SocialExportSelectorProps> = ({
  onApply,
  onAdaptCanvas,
  projectWidth,
  projectHeight,
  duration = 0,
  initialPlatformId,
}) => {
  const platforms = useMemo(() => getAllSocialPlatforms(), []);

  const [selectedId, setSelectedId] = useState<SocialPlatformId | null>(
    initialPlatformId ?? null,
  );

  const selected = selectedId
    ? platforms.find((p) => p.id === selectedId) ?? null
    : null;

  // Canvas mismatch check
  const canvasMismatch = (spec: SocialPlatformSpec) =>
    spec.width !== projectWidth || spec.height !== projectHeight;

  // Duration warning
  const durationWarning =
    selected?.maxDurationSecs !== undefined && duration > 0
      ? duration > selected.maxDurationSecs
      : false;

  // File-size estimation
  const estimatedMB =
    selected && duration > 0
      ? estimatedSize(selected.encoding.bitrate, duration)
      : null;

  const fileSizeWarning =
    selected?.maxFileSizeBytes &&
    duration > 0 &&
    (selected.encoding.bitrate * 1000 * duration) / 8 >
      selected.maxFileSizeBytes;

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* ── LEFT: Platform list ─────────────────────────────────────── */}
      <div className="w-52 shrink-0 flex flex-col gap-1.5 overflow-y-auto pr-1">
        <p className="text-[9px] text-text-muted uppercase tracking-wide px-1 mb-1">
          Plataforma destino
        </p>
        {platforms.map((spec) => (
          <PlatformCard
            key={spec.id}
            spec={spec}
            selected={selectedId === spec.id}
            hasCanvasMismatch={canvasMismatch(spec)}
            onClick={() =>
              setSelectedId((prev) => (prev === spec.id ? null : spec.id))
            }
          />
        ))}
      </div>

      {/* ── RIGHT: Detail panel ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selected ? (
          /* Empty state */
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center py-8">
            <div className="w-14 h-14 rounded-full bg-background-tertiary border border-border flex items-center justify-center">
              <Sparkles size={24} className="text-text-muted" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-secondary">
                Selecciona una plataforma
              </p>
              <p className="text-[10px] text-text-muted mt-1">
                Ver zona segura, posición de subtítulos y configuración
                optimizada.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Platform header */}
            <div
              className="flex items-center gap-3 p-3 rounded-xl border"
              style={{
                borderColor: `${selected.color}44`,
                background: `${selected.color}12`,
              }}
            >
              <span className="text-2xl">{selected.emoji}</span>
              <div>
                <p className="text-sm font-bold text-text-primary">
                  {selected.name}
                </p>
                <p className="text-[10px] text-text-muted">
                  {selected.width}×{selected.height} · {selected.aspectRatio} ·{" "}
                  {selected.frameRate}fps · H.264 ·{" "}
                  {selected.encoding.bitrate / 1000} Mbps
                </p>
              </div>
            </div>

            {/* Canvas mismatch banner */}
            {canvasMismatch(selected) && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg border border-yellow-500/40 bg-yellow-500/10">
                <AlertTriangle
                  size={13}
                  className="text-yellow-400 shrink-0 mt-0.5"
                />
                <div className="flex-1">
                  <p className="text-[10px] text-yellow-300 font-medium">
                    Canvas no coincide
                  </p>
                  <p className="text-[9px] text-yellow-400/80 mt-0.5">
                    Tu proyecto es {projectWidth}×{projectHeight}, esta
                    plataforma requiere {selected.width}×{selected.height}.
                  </p>
                </div>
                <button
                  onClick={() =>
                    onAdaptCanvas(
                      selected.width,
                      selected.height,
                      selected.frameRate,
                    )
                  }
                  className="shrink-0 flex items-center gap-1 px-2 py-1 text-[9px] font-medium rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 border border-yellow-500/40 transition-colors"
                >
                  <RefreshCw size={10} />
                  Adaptar canvas
                </button>
              </div>
            )}

            {/* Main content: preview + details side by side */}
            <div className="flex gap-4 items-start">
              {/* Safe area preview */}
              <SafeAreaPreview spec={selected} />

              {/* Spec details */}
              <div className="flex-1 space-y-3">
                {/* Constraint chips */}
                <div className="grid grid-cols-2 gap-2">
                  <Chip
                    icon={<Video size={11} />}
                    label="Resolución"
                    value={`${selected.width}×${selected.height}`}
                  />
                  <Chip
                    icon={<Video size={11} />}
                    label="Codec · Bitrate"
                    value={`${selected.encoding.codec.toUpperCase()} · ${selected.encoding.bitrate / 1000} Mbps`}
                  />
                  {selected.maxDurationSecs && (
                    <Chip
                      icon={<Clock size={11} />}
                      label="Duración máx."
                      value={formatDur(selected.maxDurationSecs)}
                      warn={durationWarning}
                    />
                  )}
                  {selected.maxFileSizeBytes && (
                    <Chip
                      icon={<HardDrive size={11} />}
                      label="Tamaño máx."
                      value={formatBytes(selected.maxFileSizeBytes)}
                      warn={!!fileSizeWarning}
                    />
                  )}
                  {duration > 0 && estimatedMB && (
                    <Chip
                      icon={<HardDrive size={11} />}
                      label="Tamaño estimado"
                      value={estimatedMB}
                    />
                  )}
                </div>

                {/* Subtitle hint */}
                <div className="flex items-start gap-2 p-2.5 rounded-lg border border-blue-500/30 bg-blue-500/10">
                  <Subtitles size={13} className="text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-medium text-blue-300">
                      {selected.subtitleHint.hardcoded
                        ? "Subtítulos hardcoded recomendados"
                        : "Subtítulos opcionales"}
                    </p>
                    <p className="text-[9px] text-blue-400/80 mt-0.5 leading-relaxed">
                      {selected.subtitleHint.note}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Tips */}
            <div className="rounded-lg border border-border bg-background-tertiary p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Info size={11} className="text-primary" />
                <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">
                  Tips para {selected.name}
                </p>
              </div>
              {selected.tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span
                    className="mt-0.5 shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                    style={{ backgroundColor: selected.color }}
                  >
                    {i + 1}
                  </span>
                  <p className="text-[10px] text-text-secondary leading-relaxed">
                    {tip}
                  </p>
                </div>
              ))}
            </div>

            {/* Warnings */}
            {durationWarning && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg border border-yellow-500/40 bg-yellow-500/10">
                <AlertTriangle
                  size={12}
                  className="text-yellow-400 shrink-0 mt-0.5"
                />
                <p className="text-[9px] text-yellow-300 leading-relaxed">
                  Tu vídeo dura{" "}
                  <strong>{formatDur(Math.round(duration))}</strong>, pero{" "}
                  {selected.name} permite un máximo de{" "}
                  <strong>
                    {formatDur(selected.maxDurationSecs!)}
                  </strong>
                  . Recorta antes de exportar o el vídeo podría ser rechazado.
                </p>
              </div>
            )}

            {/* Action button */}
            <button
              onClick={() => onApply(specToExportSettings(selected))}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ background: selected.color }}
            >
              <span className="text-base">{selected.emoji}</span>
              Exportar para {selected.name}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SocialExportSelector;
