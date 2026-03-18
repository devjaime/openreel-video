/**
 * StemSeparatorSection — Separación de Stems de Audio
 *
 * Separates a clip's audio into two layers:
 *   🎤 Voz     — harmonic content (speech, melody, sustained tones)
 *   🎵 Fondo   — percussive / background music
 *
 * Uses the HPSS algorithm (Harmonic-Percussive Source Separation) with
 * Wiener soft-masks, accelerated in the browser via WebAudio + Web Workers.
 * TensorFlow.js is used for the interactive spectrogram canvas (WebGL-backed).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import {
  Mic,
  Music2,
  Loader2,
  Download,
  Play,
  Square,
  AlertTriangle,
  Sliders,
  Scissors,
} from "lucide-react";
import {
  StemSeparator,
  type StemSeparationResult,
  type StemSeparatorConfig,
} from "@openreel/core";

// ──────────────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function dbToLinear(db: number) {
  return Math.pow(10, db / 20);
}

// ──────────────────────────────────────────────────────────────────────────────
// Spectrogram canvas (TF.js WebGL-backed)
// ──────────────────────────────────────────────────────────────────────────────

interface SpectrogramCanvasProps {
  audioData: Float32Array | null;
  sampleRate: number;
  label: string;
  color: string; // tailwind-compatible hex
  height?: number;
}

const SpectrogramCanvas: React.FC<SpectrogramCanvasProps> = ({
  audioData,
  sampleRate,
  label,
  color,
  height = 56,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!audioData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);

    // Build a lightweight spectrogram using TF.js tensors (WebGL GPU path)
    tf.tidy(() => {
      const FFT_SIZE = 256;
      const HOP = 128;
      const numFrames = Math.floor((audioData.length - FFT_SIZE) / HOP) + 1;
      const numBins = FFT_SIZE / 2;

      // Build [numBins × numFrames] power matrix
      const colData = new Float32Array(numBins * numFrames);
      let globalMax = 1e-10;

      for (let f = 0; f < numFrames; f++) {
        const start = f * HOP;
        const real = new Float32Array(FFT_SIZE);

        for (let i = 0; i < FFT_SIZE; i++) {
          const idx = start + i;
          const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
          real[i] = (idx < audioData.length ? audioData[idx] : 0) * w;
        }

        // DFT via TF.js spectral ops (GPU path)
        const signal = tf.tensor1d(real);
        const spectrum = tf.spectral.rfft(signal);
        const power = tf.abs(spectrum);
        const powerArr = power.arraySync() as number[];

        for (let b = 0; b < numBins; b++) {
          const v = powerArr[b];
          colData[b * numFrames + f] = v;
          if (v > globalMax) globalMax = v;
        }
      }

      // Normalize and draw to canvas
      const imageData = ctx.createImageData(W, H);
      const logMax = Math.log(globalMax + 1);

      // Parse hex color to RGB
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b_c = parseInt(color.slice(5, 7), 16);

      for (let py = 0; py < H; py++) {
        const bin = Math.floor(((H - 1 - py) / (H - 1)) * (numBins - 1));
        for (let px = 0; px < W; px++) {
          const frame = Math.floor((px / (W - 1)) * (numFrames - 1));
          const rawVal = colData[bin * numFrames + frame] || 0;
          const norm = Math.log(rawVal + 1) / logMax; // 0..1
          const alpha = Math.min(255, Math.floor(norm * 230));

          const idx = (py * W + px) * 4;
          imageData.data[idx] = r;
          imageData.data[idx + 1] = g;
          imageData.data[idx + 2] = b_c;
          imageData.data[idx + 3] = alpha;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    });
  }, [audioData, sampleRate, color]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={260}
        height={height}
        className="w-full rounded-md border border-border/30"
        style={{ background: "#0a0a0f" }}
      />
      <span className="absolute bottom-1 left-2 text-[9px] font-mono text-text-muted/70 select-none">
        {label}
      </span>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Waveform mini-preview (simple canvas)
// ──────────────────────────────────────────────────────────────────────────────

const WaveformPreview: React.FC<{
  data: Float32Array;
  color: string;
  height?: number;
}> = ({ data, color, height = 36 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);

    const step = Math.max(1, Math.floor(data.length / W));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      let min = 0;
      let max = 0;
      for (let j = 0; j < step; j++) {
        const s = data[x * step + j] || 0;
        if (s < min) min = s;
        if (s > max) max = s;
      }
      const y1 = H / 2 - (max * H) / 2;
      const y2 = H / 2 - (min * H) / 2;
      if (x === 0) ctx.moveTo(x, y1);
      ctx.lineTo(x, y1);
      ctx.lineTo(x, y2);
    }
    ctx.stroke();
  }, [data, color]);

  return (
    <canvas
      ref={canvasRef}
      width={260}
      height={height}
      className="w-full rounded border border-border/20"
      style={{ background: "#0d0d14" }}
    />
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// StemSeparatorSection — Main component
// ──────────────────────────────────────────────────────────────────────────────

export type StemSeparatorStatus =
  | "idle"
  | "loading"
  | "processing"
  | "done"
  | "error";

interface StemPlayerState {
  playing: boolean;
  source: AudioBufferSourceNode | null;
}

export const StemSeparatorSection: React.FC<{
  /** Raw AudioBuffer to process (from the selected clip) */
  audioBuffer?: AudioBuffer | null;
  /** Called when the user wants to replace the clip audio with the voice stem */
  onApplyVoice?: (buffer: AudioBuffer) => void;
  /** Called when the user wants to add the background stem as a new track */
  onAddBackground?: (buffer: AudioBuffer) => void;
}> = ({ audioBuffer, onApplyVoice, onAddBackground }) => {
  const [status, setStatus] = useState<StemSeparatorStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<StemSeparationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Config sliders
  const [harmonicKernel, setHarmonicKernel] = useState(17);
  const [percussiveKernel, setPercussiveKernel] = useState(17);
  const [margin, setMargin] = useState(1.0);
  const [voiceGainDb, setVoiceGainDb] = useState(0);
  const [bgGainDb, setBgGainDb] = useState(0);
  const [showConfig, setShowConfig] = useState(false);

  // Playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const voicePlayer = useRef<StemPlayerState>({ playing: false, source: null });
  const bgPlayer = useRef<StemPlayerState>({ playing: false, source: null });
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [bgPlaying, setBgPlaying] = useState(false);

  // Derived AudioBuffers from result
  const [voiceBuffer, setVoiceBuffer] = useState<AudioBuffer | null>(null);
  const [bgBuffer, setBgBuffer] = useState<AudioBuffer | null>(null);

  // ── Build AudioBuffers from result ────────────────────────────────────────

  useEffect(() => {
    if (!result) {
      setVoiceBuffer(null);
      setBgBuffer(null);
      return;
    }

    const ctx = getAudioContext();
    const sr = result.sampleRate;

    const vBuf = ctx.createBuffer(1, result.voice.length, sr);
    vBuf.copyToChannel(Float32Array.from(result.voice), 0);
    setVoiceBuffer(vBuf);

    const bBuf = ctx.createBuffer(1, result.background.length, sr);
    bBuf.copyToChannel(Float32Array.from(result.background), 0);
    setBgBuffer(bBuf);
  }, [result]);

  // ── Separation ────────────────────────────────────────────────────────────

  const handleSeparate = useCallback(async () => {
    if (!audioBuffer) return;

    setStatus("processing");
    setProgress(0);
    setError(null);
    setResult(null);
    setVoiceBuffer(null);
    setBgBuffer(null);
    stopAll();

    try {
      // Mix down to mono
      const mono = monoMix(audioBuffer);
      const cfg: Partial<StemSeparatorConfig> = {
        harmonicKernel,
        percussiveKernel,
        margin,
      };

      const separator = new StemSeparator(cfg);
      const res = await separator.separate(
        mono,
        audioBuffer.sampleRate,
        (f) => {
          setProgress(Math.round(f * 100));
        },
      );

      setResult(res);
      setStatus("done");
    } catch (e) {
      console.error("[StemSeparator]", e);
      setError(e instanceof Error ? e.message : "Error desconocido");
      setStatus("error");
    }
  }, [audioBuffer, harmonicKernel, percussiveKernel, margin]);

  // ── Playback ──────────────────────────────────────────────────────────────

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  function stopPlayer(state: React.MutableRefObject<StemPlayerState>) {
    state.current.source?.stop();
    state.current.source?.disconnect();
    state.current = { playing: false, source: null };
  }

  function stopAll() {
    stopPlayer(voicePlayer);
    stopPlayer(bgPlayer);
    setVoicePlaying(false);
    setBgPlaying(false);
  }

  const playBuffer = useCallback(
    (
      buf: AudioBuffer,
      gainDb: number,
      playerRef: React.MutableRefObject<StemPlayerState>,
      setPlaying: (v: boolean) => void,
    ) => {
      const ctx = getAudioContext();
      if (ctx.state === "suspended") ctx.resume();

      // Stop existing
      stopPlayer(playerRef);

      const src = ctx.createBufferSource();
      src.buffer = buf;

      const gain = ctx.createGain();
      gain.gain.value = dbToLinear(gainDb);
      src.connect(gain).connect(ctx.destination);
      src.start();
      src.onended = () => {
        setPlaying(false);
        playerRef.current = { playing: false, source: null };
      };

      playerRef.current = { playing: true, source: src };
      setPlaying(true);
    },
    [],
  );

  const toggleVoice = () => {
    if (!voiceBuffer) return;
    if (voicePlaying) {
      stopPlayer(voicePlayer);
      setVoicePlaying(false);
    } else {
      playBuffer(voiceBuffer, voiceGainDb, voicePlayer, setVoicePlaying);
    }
  };

  const toggleBg = () => {
    if (!bgBuffer) return;
    if (bgPlaying) {
      stopPlayer(bgPlayer);
      setBgPlaying(false);
    } else {
      playBuffer(bgBuffer, bgGainDb, bgPlayer, setBgPlaying);
    }
  };

  // ── Export (download) ─────────────────────────────────────────────────────

  const exportStem = useCallback(
    async (buf: AudioBuffer, filename: string) => {
      const offCtx = new OfflineAudioContext(
        buf.numberOfChannels,
        buf.length,
        buf.sampleRate,
      );
      const src = offCtx.createBufferSource();
      src.buffer = buf;
      src.connect(offCtx.destination);
      src.start();
      const rendered = await offCtx.startRendering();

      // Encode to WAV (PCM-16)
      const wavBlob = audioBufferToWavBlob(rendered);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const noAudio = !audioBuffer;
  const isLong = audioBuffer && audioBuffer.duration > 300; // > 5 min warning

  return (
    <div className="space-y-3 text-sm">
      {/* Header info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-text-muted text-xs">
          <Scissors className="w-3 h-3" />
          <span>Separación HPSS · Wiener mask</span>
        </div>
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="p-1 rounded hover:bg-white/5 text-text-muted transition-colors"
          title="Ajustes avanzados"
        >
          <Sliders className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Audio info */}
      {audioBuffer && (
        <div className="flex gap-2 text-xs text-text-muted bg-background-tertiary/50 rounded px-2 py-1.5">
          <span className="font-mono">{formatDuration(audioBuffer.duration)}</span>
          <span>·</span>
          <span>{(audioBuffer.sampleRate / 1000).toFixed(1)} kHz</span>
          <span>·</span>
          <span>{audioBuffer.numberOfChannels}ch</span>
        </div>
      )}

      {/* Long audio warning */}
      {isLong && status === "idle" && (
        <div className="flex items-start gap-1.5 text-xs text-yellow-400 bg-yellow-400/10 rounded px-2 py-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>Audio &gt; 5 min. El procesamiento puede tardar 30–60 s.</span>
        </div>
      )}

      {/* Advanced config */}
      {showConfig && (
        <div className="space-y-2 bg-background-tertiary/40 rounded-lg p-2.5 border border-border/20">
          <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
            Parámetros HPSS
          </p>
          <label className="flex items-center justify-between text-xs text-text-secondary">
            <span>Filtro armónico</span>
            <span className="font-mono text-text-muted w-6 text-right">
              {harmonicKernel}
            </span>
          </label>
          <input
            type="range"
            min={5}
            max={31}
            step={2}
            value={harmonicKernel}
            onChange={(e) => setHarmonicKernel(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <label className="flex items-center justify-between text-xs text-text-secondary">
            <span>Filtro percusivo</span>
            <span className="font-mono text-text-muted w-6 text-right">
              {percussiveKernel}
            </span>
          </label>
          <input
            type="range"
            min={5}
            max={31}
            step={2}
            value={percussiveKernel}
            onChange={(e) => setPercussiveKernel(Number(e.target.value))}
            className="w-full accent-purple-500"
          />
          <label className="flex items-center justify-between text-xs text-text-secondary">
            <span>Margen Wiener</span>
            <span className="font-mono text-text-muted w-8 text-right">
              {margin.toFixed(1)}
            </span>
          </label>
          <input
            type="range"
            min={0.5}
            max={3.0}
            step={0.1}
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value))}
            className="w-full accent-green-500"
          />
        </div>
      )}

      {/* Separate button */}
      <button
        onClick={handleSeparate}
        disabled={noAudio || status === "processing"}
        className={[
          "w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
          noAudio
            ? "opacity-40 cursor-not-allowed bg-white/5 text-text-muted"
            : status === "processing"
              ? "bg-blue-600/20 text-blue-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer",
        ].join(" ")}
      >
        {status === "processing" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Separando… {progress}%</span>
          </>
        ) : (
          <>
            <Scissors className="w-4 h-4" />
            <span>Separar audio</span>
          </>
        )}
      </button>

      {/* Progress bar */}
      {status === "processing" && (
        <div className="w-full h-1 bg-border/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Error */}
      {status === "error" && error && (
        <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-400/10 rounded px-2 py-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {status === "done" && result && voiceBuffer && bgBuffer && (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
            Stems separados · {formatDuration(result.duration)}
          </p>

          {/* ── Voice stem ── */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs font-medium text-blue-300">Voz</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleVoice}
                  className="p-1 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                  title={voicePlaying ? "Detener" : "Escuchar voz"}
                >
                  {voicePlaying ? (
                    <Square className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                </button>
                <button
                  onClick={() =>
                    exportStem(voiceBuffer!, "videoforge-voz.wav")
                  }
                  className="p-1 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                  title="Descargar stem de voz"
                >
                  <Download className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Spectrogram */}
            <SpectrogramCanvas
              audioData={result.voice}
              sampleRate={result.sampleRate}
              label="Espectrograma · Voz"
              color="#60a5fa"
              height={48}
            />

            {/* Waveform */}
            <WaveformPreview data={result.voice} color="#3b82f6" />

            {/* Gain */}
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="w-10 shrink-0">Volumen</span>
              <input
                type="range"
                min={-20}
                max={12}
                step={0.5}
                value={voiceGainDb}
                onChange={(e) => setVoiceGainDb(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="font-mono w-10 text-right">
                {voiceGainDb > 0 ? "+" : ""}
                {voiceGainDb.toFixed(1)} dB
              </span>
            </div>

            {/* Apply button */}
            {onApplyVoice && (
              <button
                onClick={() => onApplyVoice(voiceBuffer!)}
                className="w-full text-xs py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 transition-colors"
              >
                Reemplazar audio del clip con la voz
              </button>
            )}
          </div>

          {/* ── Background stem ── */}
          <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Music2 className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-xs font-medium text-purple-300">
                  Fondo / Música
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleBg}
                  className="p-1 rounded hover:bg-purple-500/20 text-purple-400 transition-colors"
                  title={bgPlaying ? "Detener" : "Escuchar fondo"}
                >
                  {bgPlaying ? (
                    <Square className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                </button>
                <button
                  onClick={() =>
                    exportStem(bgBuffer!, "videoforge-fondo.wav")
                  }
                  className="p-1 rounded hover:bg-purple-500/20 text-purple-400 transition-colors"
                  title="Descargar stem de fondo"
                >
                  <Download className="w-3 h-3" />
                </button>
              </div>
            </div>

            <SpectrogramCanvas
              audioData={result.background}
              sampleRate={result.sampleRate}
              label="Espectrograma · Fondo"
              color="#c084fc"
              height={48}
            />

            <WaveformPreview data={result.background} color="#a855f7" />

            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="w-10 shrink-0">Volumen</span>
              <input
                type="range"
                min={-20}
                max={12}
                step={0.5}
                value={bgGainDb}
                onChange={(e) => setBgGainDb(Number(e.target.value))}
                className="flex-1 accent-purple-500"
              />
              <span className="font-mono w-10 text-right">
                {bgGainDb > 0 ? "+" : ""}
                {bgGainDb.toFixed(1)} dB
              </span>
            </div>

            {onAddBackground && (
              <button
                onClick={() => onAddBackground(bgBuffer!)}
                className="w-full text-xs py-1 rounded bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 transition-colors"
              >
                Añadir fondo como nueva pista
              </button>
            )}
          </div>
        </div>
      )}

      {/* Idle hint */}
      {status === "idle" && !noAudio && (
        <p className="text-[11px] text-text-muted text-center leading-relaxed">
          Analiza el espectrograma del clip y separa la voz del fondo musical.
          <br />
          El procesamiento ocurre 100% en tu navegador.
        </p>
      )}

      {noAudio && (
        <p className="text-[11px] text-text-muted text-center">
          Selecciona un clip de audio o video para separar sus stems.
        </p>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────

function monoMix(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const mono = new Float32Array(len);
  const ch = buffer.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i];
  }
  if (ch > 1) {
    const inv = 1 / ch;
    for (let i = 0; i < len; i++) mono[i] *= inv;
  }
  return mono;
}

/** Encode an AudioBuffer as PCM-16 WAV Blob */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const byteLen = len * numCh * 2; // 16-bit = 2 bytes
  const ab = new ArrayBuffer(44 + byteLen);
  const view = new DataView(ab);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + byteLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, byteLen, true);

  let offset = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([ab], { type: "audio/wav" });
}
