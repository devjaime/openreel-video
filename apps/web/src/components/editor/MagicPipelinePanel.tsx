/**
 * MagicPipelinePanel
 *
 * Slide-in panel triggered by the "🪄 Publicar" toolbar button.
 * Shows 9 step cards with live progress, an OpenRouter key settings section,
 * platform selector for exports, and the generated thumbnail + reels list.
 */
import React, { useState, useCallback } from "react";
import {
  X,
  Wand2,
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  ExternalLink,
  Download,
  Check,
  AlertTriangle,
  Loader2,
  Settings2,
  RotateCcw,
} from "lucide-react";
import {
  useMagicPipelineStore,
  type PipelineStepId,
  type PipelineStep,
} from "../../stores/magic-pipeline-store";
import { runMagicPipeline } from "../../services/magic-pipeline-runner";
import { getStoredApiKey, saveApiKey, clearApiKey } from "@openreel/core";
import { SOCIAL_PLATFORM_SPECS } from "@openreel/core";
import type { SocialPlatformId } from "@openreel/core";

// ──────────────────────────────────────────────────────────────────────────────
// Step card
// ──────────────────────────────────────────────────────────────────────────────

const StepCard: React.FC<{ step: PipelineStep; onToggle: () => void }> = ({
  step,
  onToggle,
}) => {
  const statusColors = {
    pending: "text-text-muted border-border/30",
    running: "text-blue-300 border-blue-500/30 bg-blue-500/5",
    done: "text-green-300 border-green-500/30 bg-green-500/5",
    skipped: "text-text-muted/50 border-border/20",
    error: "text-red-300 border-red-500/30 bg-red-500/5",
  } as const;

  const statusIcon = {
    pending: <div className="w-4 h-4 rounded-full border border-current opacity-40" />,
    running: <Loader2 className="w-4 h-4 animate-spin text-blue-400" />,
    done: <Check className="w-4 h-4 text-green-400" />,
    skipped: <div className="w-4 h-4 rounded-full border border-current opacity-20" />,
    error: <AlertTriangle className="w-4 h-4 text-red-400" />,
  } as const;

  return (
    <div
      className={`rounded-lg border px-3 py-2 transition-all ${statusColors[step.status]} ${
        !step.enabled ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Toggle checkbox */}
        <button
          onClick={onToggle}
          className="shrink-0 w-4 h-4 rounded border border-current flex items-center justify-center transition-opacity hover:opacity-80"
          title={step.enabled ? "Desactivar paso" : "Activar paso"}
        >
          {step.enabled && <div className="w-2 h-2 rounded-sm bg-current" />}
        </button>

        {/* Emoji */}
        <span className="shrink-0 text-base leading-none">{step.emoji}</span>

        {/* Labels */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium truncate">{step.label}</span>
            {statusIcon[step.status]}
          </div>
          {step.status === "running" && step.progress > 0 && (
            <div className="mt-1 h-0.5 bg-border/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-400 transition-all duration-300"
                style={{ width: `${step.progress}%` }}
              />
            </div>
          )}
          {(step.detail || step.error) && (
            <p className="text-[10px] mt-0.5 text-current opacity-70 leading-snug">
              {step.error ?? step.detail}
            </p>
          )}
        </div>

        {step.requiresApiKey && (
          <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-mono">
            AI
          </span>
        )}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Platform badge
// ──────────────────────────────────────────────────────────────────────────────

const PLATFORMS_ORDER: SocialPlatformId[] = [
  "youtube",
  "tiktok",
  "instagram-reels",
  "linkedin",
  "twitter",
  "shorts",
];

const PlatformSelector: React.FC<{
  selected: SocialPlatformId[];
  onChange: (ids: SocialPlatformId[]) => void;
}> = ({ selected, onChange }) => {
  const toggle = (id: SocialPlatformId) => {
    onChange(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    );
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {PLATFORMS_ORDER.map((id) => {
        const spec = SOCIAL_PLATFORM_SPECS[id];
        if (!spec) return null;
        const active = selected.includes(id);
        return (
          <button
            key={id}
            onClick={() => toggle(id)}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-all ${
              active
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/30 text-text-muted hover:border-border hover:text-text-secondary"
            }`}
          >
            <span>{spec.emoji}</span>
            <span>{spec.name}</span>
          </button>
        );
      })}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// API Key section
// ──────────────────────────────────────────────────────────────────────────────

const ApiKeySection: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);

  const storedKey = getStoredApiKey();

  const handleSave = useCallback(() => {
    if (inputVal.trim()) {
      saveApiKey(inputVal.trim());
      setInputVal("");
      setTestResult(null);
    }
  }, [inputVal]);

  const handleClear = useCallback(() => {
    clearApiKey();
    setTestResult(null);
  }, []);

  const handleTest = useCallback(async () => {
    const { OpenRouterClient } = await import("@openreel/core");
    const key = getStoredApiKey();
    if (!key) return;
    setTesting(true);
    const client = new OpenRouterClient({ apiKey: key });
    const result = await client.testConnection();
    setTestResult(result.ok ? "ok" : "error");
    setTesting(false);
  }, []);

  const maskedKey = storedKey
    ? `${storedKey.slice(0, 8)}...${storedKey.slice(-4)}`
    : null;

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-xs font-medium text-text-secondary">
            OpenRouter API
          </span>
          {storedKey && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
              configurado
            </span>
          )}
        </div>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/20">
          <p className="text-[10px] text-text-muted mt-2 leading-relaxed">
            Necesaria para generar miniaturas y mejorar la detección de reels con IA.
            Tu clave se guarda solo en tu navegador.
          </p>

          {storedKey ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <code className="flex-1 font-mono bg-background-tertiary px-2 py-1.5 rounded text-text-muted truncate">
                  {showKey ? storedKey : maskedKey}
                </code>
                <button
                  onClick={() => setShowKey((v) => !v)}
                  className="p-1 rounded hover:bg-white/10 text-text-muted"
                >
                  {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 rounded border border-border/30 hover:border-border text-text-muted hover:text-text-secondary transition-colors"
                >
                  {testing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : testResult === "ok" ? (
                    <Check className="w-3 h-3 text-green-400" />
                  ) : testResult === "error" ? (
                    <AlertTriangle className="w-3 h-3 text-red-400" />
                  ) : null}
                  {testing ? "Probando…" : testResult === "ok" ? "Conexión OK" : testResult === "error" ? "Error" : "Probar conexión"}
                </button>
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1 text-[10px] py-1.5 px-2 rounded border border-red-500/20 hover:border-red-500/40 text-red-400/70 hover:text-red-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Eliminar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  placeholder="sk-or-v1-..."
                  className="flex-1 text-xs bg-background-tertiary border border-border/30 rounded px-2 py-1.5 text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-primary/40"
                />
                <button
                  onClick={handleSave}
                  disabled={!inputVal.trim()}
                  className="text-[10px] px-3 py-1.5 rounded bg-primary/20 hover:bg-primary/30 text-primary disabled:opacity-40 transition-colors"
                >
                  Guardar
                </button>
              </div>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-blue-400/70 hover:text-blue-400 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Obtener clave en openrouter.ai/keys
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// MagicPipelinePanel — main component
// ──────────────────────────────────────────────────────────────────────────────

export const MagicPipelinePanel: React.FC = () => {
  const {
    isOpen,
    closePanel,
    status,
    steps,
    config,
    thumbnailDataUrl,
    reelsCuts,
    toggleStep,
    updateConfig,
    resetPipeline,
    _abort,
  } = useMagicPipelineStore();

  const [configOpen, setConfigOpen] = useState(false);

  const handleRun = useCallback(async () => {
    await runMagicPipeline(config);
  }, [config]);

  const handleAbort = useCallback(() => {
    _abort();
  }, [_abort]);

  const downloadThumbnail = useCallback(() => {
    if (!thumbnailDataUrl) return;
    const a = document.createElement("a");
    a.href = thumbnailDataUrl;
    a.download = "videoforge-thumbnail.png";
    a.click();
  }, [thumbnailDataUrl]);

  if (!isOpen) return null;

  const isRunning = status === "running";
  const isDone = status === "done";
  const isError = status === "error";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/25 z-40"
        onClick={closePanel}
      />

      {/* Panel */}
      <div className="fixed top-16 right-0 bottom-0 w-96 bg-background-secondary border-l border-border z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-lg ${
                isRunning
                  ? "bg-purple-500/20 animate-pulse"
                  : isDone
                    ? "bg-green-500/20"
                    : isError
                      ? "bg-red-500/20"
                      : "bg-purple-500/10"
              }`}
            >
              <Wand2
                className={`w-4 h-4 ${
                  isRunning
                    ? "text-purple-400"
                    : isDone
                      ? "text-green-400"
                      : isError
                        ? "text-red-400"
                        : "text-purple-400"
                }`}
              />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Publicar en Redes
              </h2>
              <p className="text-[10px] text-text-muted">
                {isRunning
                  ? "Procesando…"
                  : isDone
                    ? "¡Listo para publicar!"
                    : isError
                      ? "Completado con errores"
                      : status === "aborted"
                        ? "Cancelado"
                        : "Pipeline de producción completo"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {(isDone || isError || status === "aborted") && (
              <button
                onClick={resetPipeline}
                className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-secondary transition-colors"
                title="Reiniciar pipeline"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={closePanel}
              className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* API key */}
          <ApiKeySection />

          {/* Config (collapsible) */}
          <div className="border border-border/30 rounded-lg overflow-hidden">
            <button
              onClick={() => setConfigOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
            >
              <span className="text-xs font-medium text-text-secondary">
                Configuración
              </span>
              {configOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              )}
            </button>
            {configOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-border/20">
                {/* Platforms */}
                <div className="mt-2 space-y-1.5">
                  <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                    Plataformas de exportación
                  </label>
                  <PlatformSelector
                    selected={config.exportPlatforms}
                    onChange={(ids) => updateConfig({ exportPlatforms: ids })}
                  />
                </div>

                {/* Reels duration */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                      Duración de reels
                    </label>
                    <span className="text-[10px] font-mono text-text-muted">
                      {config.reelsDuration}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={90}
                    step={15}
                    value={config.reelsDuration}
                    onChange={(e) =>
                      updateConfig({ reelsDuration: Number(e.target.value) })
                    }
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-[9px] text-text-muted/50">
                    <span>15s</span>
                    <span>30s</span>
                    <span>60s</span>
                    <span>90s</span>
                  </div>
                </div>

                {/* Language */}
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                    Idioma
                  </label>
                  <select
                    value={config.language}
                    onChange={(e) => updateConfig({ language: e.target.value })}
                    className="w-full text-xs bg-background-tertiary border border-border/30 rounded px-2 py-1.5 text-text-primary focus:outline-none"
                  >
                    <option value="es">Español</option>
                    <option value="en">English</option>
                    <option value="pt">Português</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Step cards */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold px-0.5">
              Pasos del pipeline
            </p>
            {steps.map((step) => (
              <StepCard
                key={step.id}
                step={step}
                onToggle={() => toggleStep(step.id as PipelineStepId)}
              />
            ))}
          </div>

          {/* Results: thumbnail */}
          {thumbnailDataUrl && (
            <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                🖼️ Miniatura YouTube
              </p>
              <div className="relative rounded-lg overflow-hidden border border-border/30">
                <img
                  src={thumbnailDataUrl}
                  alt="Miniatura generada"
                  className="w-full aspect-video object-cover"
                />
                <button
                  onClick={downloadThumbnail}
                  className="absolute bottom-2 right-2 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded bg-black/60 hover:bg-black/80 text-white transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Descargar
                </button>
              </div>
            </div>
          )}

          {/* Results: reels */}
          {reelsCuts.length > 0 && (
            <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                🎬 Reels identificados
              </p>
              {reelsCuts.map((cut, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border/20 bg-background-tertiary/40 px-3 py-2 space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-text-primary leading-snug">
                      {cut.title}
                    </p>
                    <span className="shrink-0 text-[9px] font-mono text-text-muted bg-background-secondary px-1.5 py-0.5 rounded">
                      {Math.round(cut.score * 100)}%
                    </span>
                  </div>
                  <p className="text-[10px] text-text-muted font-mono">
                    {formatTime(cut.startTime)} → {formatTime(cut.endTime)} ·{" "}
                    {Math.round(cut.endTime - cut.startTime)}s
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Idle hint */}
          {status === "idle" && (
            <div className="text-center py-4 space-y-2">
              <div className="text-4xl">🚀</div>
              <p className="text-xs text-text-muted leading-relaxed max-w-xs mx-auto">
                Un clic para procesar el audio, transcribir, detectar muletillas,
                cortar reels, generar miniatura y preparar los archivos para cada red social.
              </p>
            </div>
          )}
        </div>

        {/* Footer: Run / Abort */}
        <div className="shrink-0 p-4 border-t border-border">
          {isRunning ? (
            <button
              onClick={handleAbort}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/20 transition-colors text-sm font-medium"
            >
              <Square className="w-4 h-4" />
              Cancelar pipeline
            </button>
          ) : isDone ? (
            <div className="flex items-center justify-center gap-2 py-2.5 text-green-400 text-sm font-medium">
              <Check className="w-4 h-4" />
              ¡Todo listo para publicar!
            </div>
          ) : (
            <button
              onClick={handleRun}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold transition-all shadow-lg hover:shadow-purple-500/30 text-sm"
            >
              <Play className="w-4 h-4" />
              {status === "error" || status === "aborted"
                ? "Reintentar pipeline"
                : "Iniciar pipeline completo"}
            </button>
          )}
        </div>
      </div>
    </>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────────────────────────────────────

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
