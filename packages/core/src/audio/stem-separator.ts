/**
 * Stem Separator — Harmonic-Percussive Source Separation (HPSS)
 *
 * Splits a mono audio signal into two stems:
 *  - voice  : harmonic component (speech, melody, sustained tones)
 *  - background : percussive component (drums, transients, background noise)
 *
 * Algorithm: HPSS with Wiener soft masks
 *  1. Compute STFT of the input signal (windowed frames)
 *  2. Median-filter spectrogram along TIME axis  → harmonic model
 *  3. Median-filter spectrogram along FREQ axis  → percussive model
 *  4. Build Wiener masks from the two models
 *  5. Apply masks to STFT and reconstruct via overlap-add ISTFT
 *
 * References:
 *  Fitzgerald, D. (2010). Harmonic/percussive separation using median filtering.
 *  Driedger, J., Müller, M., Disch, S. (2014). Extending harmonic-percussive separation.
 */

import { FFT } from "./fft";

// ──────────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────────

export interface StemSeparationResult {
  /** Harmonic (vocal / melodic) stem samples */
  voice: Float32Array;
  /** Percussive / background stem samples */
  background: Float32Array;
  sampleRate: number;
  duration: number;
}

export interface StemSeparatorConfig {
  /** STFT window size in samples (must be power-of-2). Default: 2048 */
  fftSize: number;
  /** Hop between successive STFT frames. Default: fftSize / 4 */
  hopSize: number;
  /** Median filter half-width along time axis (harmonic filter). Default: 17 */
  harmonicKernel: number;
  /** Median filter half-width along freq axis (percussive filter). Default: 17 */
  percussiveKernel: number;
  /**
   * Wiener margin — a value > 1 biases the mask toward the dominant component,
   * sharpening separation at the cost of some bleed. Default: 1.0 (balanced)
   */
  margin: number;
}

export const DEFAULT_STEM_SEPARATOR_CONFIG: StemSeparatorConfig = {
  fftSize: 2048,
  hopSize: 512,
  harmonicKernel: 17,
  percussiveKernel: 17,
  margin: 1.0,
};

// ──────────────────────────────────────────────────────────────────────────────
// StemSeparator class
// ──────────────────────────────────────────────────────────────────────────────

export class StemSeparator {
  private readonly cfg: StemSeparatorConfig;
  private readonly fft: FFT;

  constructor(config: Partial<StemSeparatorConfig> = {}) {
    this.cfg = { ...DEFAULT_STEM_SEPARATOR_CONFIG, ...config };
    if (this.cfg.hopSize === 0) {
      this.cfg.hopSize = this.cfg.fftSize / 4;
    }
    this.fft = new FFT(this.cfg.fftSize);
  }

  // ── Main entry point ───────────────────────────────────────────────────────

  async separate(
    audioData: Float32Array,
    sampleRate: number,
    onProgress?: (fraction: number) => void,
  ): Promise<StemSeparationResult> {
    const { fftSize, hopSize } = this.cfg;
    const numFrames =
      Math.floor((audioData.length - fftSize) / hopSize) + 1;
    const numBins = fftSize / 2;

    report(onProgress, 0.02);

    // ── Step 1: STFT ──────────────────────────────────────────────────────────
    const magnitudes: Float32Array[] = new Array(numFrames);
    const phases: Float32Array[] = new Array(numFrames);
    const hann = this.hannWindow(fftSize);

    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSize;
      const frame = this.extractFrame(audioData, start, hann);
      const { real, imag } = this.fft.forward(frame);
      const { magnitudes: mags, phases: phs } =
        this.fft.getMagnitudeAndPhase(real, imag);
      magnitudes[f] = mags;
      phases[f] = phs;
    }

    report(onProgress, 0.30);

    // ── Step 2 & 3: Median filters ────────────────────────────────────────────
    const harmonicSpec = this.medianFilterTime(magnitudes, numBins, numFrames);
    report(onProgress, 0.55);

    const percussiveSpec = this.medianFilterFreq(
      magnitudes,
      numBins,
      numFrames,
    );
    report(onProgress, 0.70);

    // ── Step 4: Wiener soft masks ─────────────────────────────────────────────
    const { voiceMasks, bgMasks } = this.buildMasks(
      harmonicSpec,
      percussiveSpec,
      numBins,
      numFrames,
    );

    // ── Step 5: Inverse STFT (overlap-add) ───────────────────────────────────
    const voiceOut = new Float32Array(audioData.length);
    const bgOut = new Float32Array(audioData.length);
    const normBuf = new Float32Array(audioData.length);
    const w2 = hann.map((v) => v * v); // squared synthesis window for normalization

    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSize;

      const voiceFrame = this.maskedISTFT(
        magnitudes[f],
        phases[f],
        voiceMasks[f],
      );
      const bgFrame = this.maskedISTFT(magnitudes[f], phases[f], bgMasks[f]);

      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        if (idx >= audioData.length) break;
        voiceOut[idx] += voiceFrame[i] * hann[i];
        bgOut[idx] += bgFrame[i] * hann[i];
        normBuf[idx] += w2[i];
      }
    }

    // Normalize overlap-add
    for (let i = 0; i < audioData.length; i++) {
      const n = normBuf[i] || 1e-10;
      voiceOut[i] /= n;
      bgOut[i] /= n;
    }

    report(onProgress, 1.0);

    return {
      voice: voiceOut,
      background: bgOut,
      sampleRate,
      duration: audioData.length / sampleRate,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private hannWindow(size: number): Float32Array {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return w;
  }

  private extractFrame(
    input: Float32Array,
    start: number,
    window: Float32Array,
  ): Float32Array {
    const frame = new Float32Array(this.cfg.fftSize);
    for (let i = 0; i < this.cfg.fftSize; i++) {
      const idx = start + i;
      frame[i] = (idx < input.length ? input[idx] : 0) * window[i];
    }
    return frame;
  }

  /** Median filter along TIME axis → extracts harmonic content */
  private medianFilterTime(
    magnitudes: Float32Array[],
    numBins: number,
    numFrames: number,
  ): Float32Array[] {
    const half = this.cfg.harmonicKernel;
    const result: Float32Array[] = Array.from(
      { length: numFrames },
      () => new Float32Array(numBins),
    );
    const buf: number[] = [];

    for (let b = 0; b < numBins; b++) {
      for (let f = 0; f < numFrames; f++) {
        buf.length = 0;
        const lo = Math.max(0, f - half);
        const hi = Math.min(numFrames - 1, f + half);
        for (let d = lo; d <= hi; d++) buf.push(magnitudes[d][b]);
        result[f][b] = median(buf);
      }
    }
    return result;
  }

  /** Median filter along FREQ axis → extracts percussive content */
  private medianFilterFreq(
    magnitudes: Float32Array[],
    numBins: number,
    numFrames: number,
  ): Float32Array[] {
    const half = this.cfg.percussiveKernel;
    const result: Float32Array[] = Array.from(
      { length: numFrames },
      () => new Float32Array(numBins),
    );
    const buf: number[] = [];

    for (let f = 0; f < numFrames; f++) {
      for (let b = 0; b < numBins; b++) {
        buf.length = 0;
        const lo = Math.max(0, b - half);
        const hi = Math.min(numBins - 1, b + half);
        for (let d = lo; d <= hi; d++) buf.push(magnitudes[f][d]);
        result[f][b] = median(buf);
      }
    }
    return result;
  }

  /** Build Wiener soft masks from harmonic and percussive models */
  private buildMasks(
    harmonicSpec: Float32Array[],
    percussiveSpec: Float32Array[],
    numBins: number,
    numFrames: number,
  ): { voiceMasks: Float32Array[]; bgMasks: Float32Array[] } {
    const m = this.cfg.margin;
    const voiceMasks: Float32Array[] = new Array(numFrames);
    const bgMasks: Float32Array[] = new Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
      const vm = new Float32Array(numBins);
      const bm = new Float32Array(numBins);
      const H = harmonicSpec[f];
      const P = percussiveSpec[f];

      for (let b = 0; b < numBins; b++) {
        const h = H[b] * m;
        const p = P[b] * m;
        const denom = h + p + 1e-10;
        vm[b] = h / denom;
        bm[b] = p / denom;
      }
      voiceMasks[f] = vm;
      bgMasks[f] = bm;
    }
    return { voiceMasks, bgMasks };
  }

  /** Apply a mask to STFT frame and run ISTFT */
  private maskedISTFT(
    mags: Float32Array,
    phs: Float32Array,
    mask: Float32Array,
  ): Float32Array {
    const numBins = mags.length;
    const maskedMags = new Float32Array(numBins);
    for (let b = 0; b < numBins; b++) {
      maskedMags[b] = mags[b] * mask[b];
    }
    const { real, imag } = this.fft.fromMagnitudeAndPhase(maskedMags, phs);
    return this.fft.inverse(real, imag);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Convenience function for simple one-shot separation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Separate an AudioBuffer into voice and background stems.
 * Mixes all channels down to mono for processing, then outputs stereo pairs.
 */
export async function separateStems(
  buffer: AudioBuffer,
  context: BaseAudioContext,
  config: Partial<StemSeparatorConfig> = {},
  onProgress?: (fraction: number) => void,
): Promise<{ voice: AudioBuffer; background: AudioBuffer }> {
  // Mix down to mono
  const mono = monoMix(buffer);
  const separator = new StemSeparator(config);
  const result = await separator.separate(mono, buffer.sampleRate, onProgress);

  // Output buffers — stereo if original was stereo, else mono
  const outChannels = Math.min(buffer.numberOfChannels, 2);

  const voiceBuf = context.createBuffer(
    outChannels,
    buffer.length,
    buffer.sampleRate,
  );
  const bgBuf = context.createBuffer(
    outChannels,
    buffer.length,
    buffer.sampleRate,
  );

  const voiceArr = Float32Array.from(result.voice);
  const bgArr = Float32Array.from(result.background);
  for (let c = 0; c < outChannels; c++) {
    voiceBuf.copyToChannel(voiceArr, c);
    bgBuf.copyToChannel(bgArr, c);
  }

  return { voice: voiceBuf, background: bgBuf };
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal utilities
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
    const scale = 1 / ch;
    for (let i = 0; i < len; i++) mono[i] *= scale;
  }

  return mono;
}

function median(arr: number[]): number {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function report(cb: ((f: number) => void) | undefined, v: number): void {
  cb?.(v);
}
