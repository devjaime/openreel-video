/**
 * FillerDetectorPanel
 *
 * Panel del inspector para detectar y eliminar muletillas en español de los
 * subtítulos generados por Whisper (o cualquier transcripción con timestamps).
 *
 * Flujo de uso:
 *  1. Usuario genera subtítulos con "Auto-subtítulos IA" (WhisperSubtitlePanel).
 *  2. Abre este panel → "Analizar muletillas".
 *  3. Ve la lista de muletillas con colores por categoría.
 *  4. Hace click en una muletilla → el playhead salta a ese punto.
 *  5. Activa/desactiva checkboxes para selección individual.
 *  6. "Marcar en timeline" → agrega marcadores de color en el timeline.
 *  7. "Eliminar seleccionadas" → ripple-cut de las regiones seleccionadas.
 *
 * Integración:
 *  - detectFillers()         ← packages/core/src/audio/filler-detector.ts
 *  - project-store.timeline.subtitles  → fuente de datos
 *  - timeline-store.seekTo()           → navegación
 *  - project-store.addMarker()         → marcadores
 *  - project-store.splitClip()         → corte
 *  - project-store.rippleDeleteClip()  → eliminación ripple
 */

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import {
  Scissors,
  MapPin,
  AlertCircle,
  CheckSquare,
  Square,
  Trash2,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Zap,
  Clock,
} from "lucide-react";
import {
  detectFillers,
  FILLER_MARKER_COLORS,
  FILLER_CATEGORY_LABELS,
  formatFillerTime,
  type FillerDetection,
  type FillerCategory,
  type FillerDetectorConfig,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_FILTERS: { id: FillerCategory | "all"; label: string }[] = [
  { id: "all",        label: "Todos" },
  { id: "sound",      label: "Sonidos" },
  { id: "phrase",     label: "Frases" },
  { id: "repetition", label: "Repeticiones" },
  { id: "ambiguous",  label: "Ambiguos" },
];

const CONFIDENCE_LABELS: { min: number; label: string; color: string }[] = [
  { min: 0.85, label: "Alta",   color: "text-green-400" },
  { min: 0.60, label: "Media",  color: "text-yellow-400" },
  { min: 0,    label: "Baja",   color: "text-text-muted" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface CategoryBadgeProps {
  category: FillerCategory;
}

function CategoryBadge({ category }: CategoryBadgeProps) {
  const color = FILLER_MARKER_COLORS[category];
  const label = FILLER_CATEGORY_LABELS[category];
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {label}
    </span>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const { label, color } =
    CONFIDENCE_LABELS.find((c) => value >= c.min) ?? CONFIDENCE_LABELS[2];
  return (
    <span className={`text-[9px] font-mono ${color}`}>
      {(value * 100).toFixed(0)}%
    </span>
  );
}

interface FillerItemProps {
  detection: FillerDetection;
  selected: boolean;
  onToggle: () => void;
  onSeek: () => void;
}

function FillerItem({ detection, selected, onToggle, onSeek }: FillerItemProps) {
  const color = FILLER_MARKER_COLORS[detection.category];

  return (
    <div
      className={`flex items-start gap-2 p-2 rounded-lg border transition-colors cursor-default ${
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border/40 hover:border-border/70"
      }`}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className="mt-0.5 shrink-0 text-text-muted hover:text-primary transition-colors"
        title={selected ? "Deseleccionar" : "Seleccionar para eliminar"}
      >
        {selected ? (
          <CheckSquare size={14} className="text-primary" />
        ) : (
          <Square size={14} />
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <CategoryBadge category={detection.category} />
          {/* Quote del texto */}
          <span
            className="text-[11px] font-medium truncate max-w-[100px]"
            style={{ color }}
            title={detection.text}
          >
            "{detection.text}"
          </span>
          <ConfidencePill value={detection.confidence} />
        </div>

        {/* Razón */}
        <p className="text-[9px] text-text-muted leading-tight">
          {detection.reason}
        </p>

        {/* Pausa info for ambiguous */}
        {detection.category === "ambiguous" && (
          <p className="text-[9px] text-text-muted">
            Pausa antes: {(detection.pauseBefore * 1000).toFixed(0)} ms
            {detection.pauseAfter > 0.1
              ? ` · después: ${(detection.pauseAfter * 1000).toFixed(0)} ms`
              : ""}
          </p>
        )}
      </div>

      {/* Timestamp / seek button */}
      <button
        onClick={onSeek}
        className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded
                   text-[9px] font-mono text-text-muted
                   hover:text-primary hover:bg-primary/10 transition-colors"
        title="Ir a este punto"
      >
        <Clock size={9} />
        {formatFillerTime(detection.startTime)}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom filler input
// ─────────────────────────────────────────────────────────────────────────────

interface CustomFillerInputProps {
  custom: string[];
  onAdd: (word: string) => void;
  onRemove: (word: string) => void;
}

function CustomFillerInput({ custom, onAdd, onRemove }: CustomFillerInputProps) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const trimmed = input.trim().toLowerCase();
    if (trimmed && !custom.includes(trimmed)) {
      onAdd(trimmed);
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Añadir muletilla…"
          className="flex-1 px-2 py-1 text-[10px] rounded bg-background-secondary
                     border border-border text-text-primary
                     placeholder:text-text-muted focus:outline-none focus:border-primary
                     transition-colors"
        />
        <button
          onClick={handleAdd}
          disabled={!input.trim()}
          className="px-2 py-1 rounded bg-primary text-white text-[10px]
                     hover:bg-primary/80 transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
        </button>
      </div>
      {custom.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {custom.map((w) => (
            <span
              key={w}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                         bg-background-secondary border border-border
                         text-[9px] text-text-secondary"
            >
              {w}
              <button
                onClick={() => onRemove(w)}
                className="text-text-muted hover:text-red-400 transition-colors"
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────

export const FillerDetectorPanel: React.FC = () => {
  // Store hooks
  const subtitles = useProjectStore((s) => s.project.timeline.subtitles);
  const addMarker = useProjectStore((s) => s.addMarker);
  const splitClip = useProjectStore((s) => s.splitClip);
  const rippleDeleteClip = useProjectStore((s) => s.rippleDeleteClip);
  const seekTo = useTimelineStore((s) => s.seekTo);
  const projectTracks = useProjectStore((s) => s.project.timeline.tracks);

  // Config state
  const [customFillers, setCustomFillers] = useState<string[]>([]);
  const [ambiguousThreshold, setAmbiguousThreshold] = useState(0.45);
  const [showConfig, setShowConfig] = useState(false);

  // Results state
  const [detections, setDetections] = useState<FillerDetection[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<FillerCategory | "all">("all");
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  // Operation state
  const [isCutting, setIsCutting] = useState(false);
  const [cutProgress, setCutProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subtitlesWithWords = useMemo(
    () => subtitles.filter((s) => s.words && s.words.length > 0),
    [subtitles],
  );

  const hasSubtitles = subtitlesWithWords.length > 0;

  // ── Analysis ───────────────────────────────────────────────────────────────

  const handleAnalyze = useCallback(() => {
    setError(null);
    const config: FillerDetectorConfig = {
      customFillers,
      ambiguousThreshold,
    };
    const result = detectFillers(subtitlesWithWords, config);
    setDetections(result.detections);
    setSelected(new Set()); // reset selection
    setHasAnalyzed(true);
  }, [subtitlesWithWords, customFillers, ambiguousThreshold]);

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filteredDetections = useMemo(
    () =>
      activeFilter === "all"
        ? detections
        : detections.filter((d) => d.category === activeFilter),
    [detections, activeFilter],
  );

  // ── Selection ──────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(filteredDetections.map((d) => d.id)));
  }, [filteredDetections]);

  const deselectAll = useCallback(() => setSelected(new Set()), []);

  // ── Seek ───────────────────────────────────────────────────────────────────

  const handleSeek = useCallback(
    (t: number) => seekTo(t),
    [seekTo],
  );

  // ── Add markers ───────────────────────────────────────────────────────────

  const handleAddMarkers = useCallback(() => {
    const targets = selected.size > 0
      ? detections.filter((d) => selected.has(d.id))
      : detections;

    for (const d of targets) {
      const color = FILLER_MARKER_COLORS[d.category];
      const label = `${FILLER_CATEGORY_LABELS[d.category]}: "${d.text}"`;
      addMarker(d.startTime, label, color);
    }
  }, [detections, selected, addMarker]);

  // ── Ripple-cut helpers ─────────────────────────────────────────────────────

  /** Busca el clip que contiene un tiempo absoluto */
  const findClipAt = useCallback(
    (time: number) => {
      for (const track of projectTracks) {
        for (const clip of track.clips) {
          if (time >= clip.startTime && time < clip.startTime + clip.duration) {
            return clip;
          }
        }
      }
      return null;
    },
    [projectTracks],
  );

  /** Busca un clip cuyo punto medio esté en el rango [start, end) */
  const findClipInRange = useCallback(
    (start: number, end: number) => {
      for (const track of projectTracks) {
        for (const clip of track.clips) {
          const mid = clip.startTime + clip.duration / 2;
          if (mid >= start && mid < end) return clip;
        }
      }
      return null;
    },
    [projectTracks],
  );

  // ── Delete selected ────────────────────────────────────────────────────────

  const handleDeleteSelected = useCallback(async () => {
    if (selected.size === 0) return;

    const targets = detections
      .filter((d) => selected.has(d.id))
      .sort((a, b) => b.startTime - a.startTime); // desc → no offset issues

    setIsCutting(true);
    setError(null);

    for (let i = 0; i < targets.length; i++) {
      const d = targets[i];
      setCutProgress(
        `Eliminando ${i + 1}/${targets.length}: "${d.text}"…`,
      );

      try {
        // 1. Split at endTime (if not at clip boundary)
        const clipAtEnd = findClipAt(d.startTime);
        if (!clipAtEnd) continue;

        const relEnd = d.endTime - clipAtEnd.startTime;
        if (relEnd > 0 && relEnd < clipAtEnd.duration) {
          await splitClip(clipAtEnd.id, relEnd);
        }

        // 2. Split at startTime
        const clipAtStart = findClipAt(d.startTime);
        if (!clipAtStart) continue;

        const relStart = d.startTime - clipAtStart.startTime;
        if (relStart > 0) {
          await splitClip(clipAtStart.id, relStart);
        }

        // 3. Ripple-delete the filler segment
        const fillerClip = findClipInRange(d.startTime, d.endTime);
        if (fillerClip) {
          await rippleDeleteClip(fillerClip.id);
        }
      } catch {
        // Skip and continue with next
      }
    }

    // Remove deleted items from detections list
    setDetections((prev) => prev.filter((d) => !selected.has(d.id)));
    setSelected(new Set());
    setCutProgress(null);
    setIsCutting(false);
  }, [
    selected,
    detections,
    findClipAt,
    findClipInRange,
    splitClip,
    rippleDeleteClip,
  ]);

  // ── Stats summary ──────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    if (detections.length === 0) return null;
    const total = detections.length;
    const duration = detections.reduce(
      (sum, d) => sum + (d.endTime - d.startTime),
      0,
    );
    return { total, duration };
  }, [detections]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render: no subtítulos
  // ─────────────────────────────────────────────────────────────────────────

  if (!hasSubtitles) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-2 p-3 bg-background-tertiary rounded-lg border border-border/40">
          <AlertCircle size={14} className="text-text-muted shrink-0 mt-0.5" />
          <p className="text-[10px] text-text-muted leading-relaxed">
            Primero genera subtítulos con{" "}
            <span className="text-primary font-medium">
              Auto-subtítulos IA
            </span>{" "}
            para que tengan timestamps por palabra.
          </p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render: main
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3 w-full min-w-0 max-w-full">

      {/* Header */}
      <div className="flex items-center gap-2 p-2 bg-orange-500/10 rounded-lg border border-orange-500/30">
        <Scissors size={14} className="text-orange-400 shrink-0" />
        <div className="min-w-0">
          <span className="text-[11px] font-medium text-text-primary">
            Detector de muletillas
          </span>
          <p className="text-[9px] text-text-muted">
            {subtitlesWithWords.length} subtítulo
            {subtitlesWithWords.length !== 1 ? "s" : ""} con timestamps
          </p>
        </div>
      </div>

      {/* ── Config section ── */}
      <div className="border border-border/40 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2
                     text-[10px] text-text-secondary hover:text-text-primary
                     hover:bg-background-secondary transition-colors"
        >
          <span>Configuración</span>
          {showConfig ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showConfig && (
          <div className="px-3 pb-3 pt-1 space-y-3 bg-background-tertiary/50">

            {/* Sensibilidad */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary">
                  Sensibilidad (ambiguos)
                </span>
                <span className="text-[10px] font-mono text-text-primary">
                  {Math.round((1 - ambiguousThreshold) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={1 - ambiguousThreshold}
                onChange={(e) =>
                  setAmbiguousThreshold(1 - parseFloat(e.target.value))
                }
                className="w-full accent-primary h-1"
              />
              <div className="flex justify-between text-[8px] text-text-muted">
                <span>Conservador</span>
                <span>Agresivo</span>
              </div>
            </div>

            {/* Custom fillers */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-text-secondary">
                Muletillas personalizadas
              </span>
              <CustomFillerInput
                custom={customFillers}
                onAdd={(w) => setCustomFillers((prev) => [...prev, w])}
                onRemove={(w) =>
                  setCustomFillers((prev) => prev.filter((x) => x !== w))
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Analyze button */}
      <button
        onClick={handleAnalyze}
        disabled={isCutting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5
                   bg-orange-500 text-white rounded-lg
                   hover:bg-orange-600 transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Zap size={14} />
        <span className="text-[11px] font-medium">
          {hasAnalyzed ? "Re-analizar" : "Analizar muletillas"}
        </span>
      </button>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle size={13} className="text-red-400 shrink-0" />
          <span className="text-[10px] text-red-400">{error}</span>
        </div>
      )}

      {/* ── Results ── */}
      {hasAnalyzed && (
        <>
          {/* Summary */}
          {stats && (
            <div className="flex items-center justify-between p-2 bg-background-tertiary rounded-lg">
              <span className="text-[10px] text-text-secondary">
                <span className="text-text-primary font-medium">
                  {stats.total}
                </span>{" "}
                muletillas ·{" "}
                <span className="text-text-primary font-medium">
                  {stats.duration.toFixed(1)}s
                </span>{" "}
                de video
              </span>
              {selected.size > 0 && (
                <span className="text-[9px] text-primary font-medium">
                  {selected.size} sel.
                </span>
              )}
            </div>
          )}

          {detections.length === 0 && (
            <p className="text-center text-[10px] text-text-muted py-4">
              🎉 No se detectaron muletillas
            </p>
          )}

          {detections.length > 0 && (
            <>
              {/* Category filter tabs */}
              <div className="flex gap-1 overflow-x-auto pb-0.5">
                {CATEGORY_FILTERS.map((f) => {
                  const count =
                    f.id === "all"
                      ? detections.length
                      : detections.filter((d) => d.category === f.id).length;
                  if (count === 0 && f.id !== "all") return null;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setActiveFilter(f.id)}
                      className={`shrink-0 px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                        activeFilter === f.id
                          ? "bg-primary text-white"
                          : "text-text-muted hover:text-text-primary hover:bg-background-secondary"
                      }`}
                    >
                      {f.label}
                      <span className="ml-1 opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Select all / none */}
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="text-[9px] text-text-muted hover:text-primary transition-colors"
                  >
                    <CheckSquare size={11} className="inline mr-1" />
                    Todas
                  </button>
                  <button
                    onClick={deselectAll}
                    className="text-[9px] text-text-muted hover:text-primary transition-colors"
                  >
                    <Square size={11} className="inline mr-1" />
                    Ninguna
                  </button>
                </div>
                <span className="text-[9px] text-text-muted">
                  {filteredDetections.length} visible
                  {filteredDetections.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Detections list */}
              <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5">
                {filteredDetections.map((d) => (
                  <FillerItem
                    key={d.id}
                    detection={d}
                    selected={selected.has(d.id)}
                    onToggle={() => toggleSelect(d.id)}
                    onSeek={() => handleSeek(d.startTime)}
                  />
                ))}
              </div>

              {/* Cutting progress */}
              {isCutting && cutProgress && (
                <div className="p-2 bg-background-tertiary rounded text-[10px] text-text-secondary">
                  {cutProgress}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={handleAddMarkers}
                  disabled={isCutting}
                  title={
                    selected.size > 0
                      ? "Marcar seleccionadas"
                      : "Marcar todas"
                  }
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2
                             border border-border text-text-secondary rounded-lg text-[10px]
                             hover:border-primary/60 hover:text-primary
                             disabled:opacity-40 disabled:cursor-not-allowed
                             transition-colors"
                >
                  <MapPin size={12} />
                  {selected.size > 0 ? `Marcar (${selected.size})` : "Marcar todas"}
                </button>

                <button
                  onClick={handleDeleteSelected}
                  disabled={selected.size === 0 || isCutting}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2
                             bg-red-500/10 border border-red-500/30 text-red-400
                             rounded-lg text-[10px] font-medium
                             hover:bg-red-500/20
                             disabled:opacity-40 disabled:cursor-not-allowed
                             transition-colors"
                >
                  <Trash2 size={12} />
                  {isCutting
                    ? "Eliminando…"
                    : selected.size > 0
                      ? `Eliminar (${selected.size})`
                      : "Eliminar sel."}
                </button>
              </div>

              <p className="text-[9px] text-text-muted text-center leading-relaxed">
                "Eliminar" hace ripple-cut: cierra el hueco automáticamente.
                Usa Ctrl+Z para deshacer.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default FillerDetectorPanel;
