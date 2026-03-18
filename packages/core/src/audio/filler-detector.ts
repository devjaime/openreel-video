/**
 * FillerDetector — Detector de muletillas en español
 *
 * Analiza el array `words` de los subtítulos generados por Whisper
 * (o cualquier transcripción con timestamps por palabra) y detecta:
 *
 *  - 'sound'      : Sonidos de duda (eh, em, ah, um, mmm, uh…)
 *  - 'phrase'     : Frases muletilla (o sea, digamos, básicamente…)
 *  - 'repetition' : La misma palabra repetida 2+ veces seguidas
 *  - 'ambiguous'  : Palabras que pueden ser muletilla o conector válido
 *                   (entonces, bueno) → se decide con heurísticas de contexto
 *
 * La función principal `detectFillers` es pura (sin efectos secundarios) y
 * acepta exclusivamente tipos del dominio del editor (`Subtitle[]`), por lo
 * que puede usarse en tests sin ningún mock.
 *
 * Algoritmo de puntuación contextual para palabras ambiguas:
 *  pausa_antes > 500 ms  → +0.35
 *  pausa_antes > 300 ms  → +0.25 (else)
 *  pausa_después > 300ms → +0.20
 *  pausa_después > 200ms → +0.10 (else)
 *  duración > 1.5× media → +0.15  (hesitación alargada)
 *  frecuencia  > 4/min   → +0.20
 *  frecuencia  > 2/min   → +0.10 (else)
 *  primera palabra de segmento → +0.15
 *  ────────────────────────────────
 *  score ≥ ambiguousThreshold (default 0.45) → marcada como muletilla
 */

import type { Subtitle, SubtitleWord } from "../types/timeline";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export type FillerCategory =
  | "sound"       // sonidos de duda: siempre muletilla
  | "phrase"      // frases muletilla: casi siempre
  | "repetition"  // misma palabra consecutiva
  | "ambiguous";  // entonces / bueno → depende del contexto

export interface FillerDetection {
  readonly id: string;
  readonly category: FillerCategory;
  /** Texto exacto del fragmento detectado (tal como aparece en la transcripción) */
  readonly text: string;
  /** Tiempo absoluto en la línea de tiempo (segundos) */
  readonly startTime: number;
  readonly endTime: number;
  /** 0–1. 0.95 para sonidos/frases exactas. Variable para ambiguos. */
  readonly confidence: number;
  /** ID del subtítulo que contiene esta muletilla */
  readonly subtitleId: string;
  /** Índices de las palabras dentro del array words del subtítulo */
  readonly wordIndices: number[];
  /** Descripción legible del motivo de detección */
  readonly reason: string;
  /** Pausa antes de esta palabra (s). Útil para UI. */
  readonly pauseBefore: number;
  /** Pausa después de esta palabra (s). */
  readonly pauseAfter: number;
}

export interface FillerDetectionStats {
  readonly byCategory: Record<FillerCategory, number>;
  /** Las 5 muletillas más frecuentes */
  readonly mostCommon: string[];
  /** Segundos totales de muletillas detectadas */
  readonly totalDuration: number;
}

export interface FillerDetectionResult {
  readonly detections: FillerDetection[];
  readonly stats: FillerDetectionStats;
}

export interface FillerDetectorConfig {
  /**
   * Palabras/frases adicionales definidas por el usuario.
   * Se agregan a la lista exacta con confianza 0.9.
   */
  customFillers?: string[];
  /**
   * Umbral de score para etiquetar una palabra ambigua como muletilla.
   * Rango 0–1, default 0.45.
   */
  ambiguousThreshold?: number;
  /**
   * Pausa mínima (ms) que dispara el bonus de "entonces/bueno como muletilla".
   * Default: 300 ms.
   */
  pauseThresholdMs?: number;
  /**
   * Repeticiones consecutivas mínimas para detectar repetición (≥ 2).
   * Default: 2.
   */
  repetitionMinCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listas internas de muletillas
// ─────────────────────────────────────────────────────────────────────────────

/** Sonidos de duda: siempre muletilla */
const SOUND_FILLERS = new Set([
  "eh", "eeh", "ehh", "em", "emm",
  "ah", "ahh", "aah",
  "uh", "uhh",
  "um", "umm",
  "mm", "mmm",
  "er", "err",
  "hm", "hmm",
  // "este" omitido deliberadamente: es pronombre/determinante muy común en español
  // y causaría demasiados falsos positivos. Sólo "esteee" (alargado) si el usuario
  // lo agrega como muletilla personalizada.
]);

/**
 * Frases muletilla de una o varias palabras.
 * La clave es el texto normalizado (lowercase, sin puntuación).
 * El valor es la razón para mostrar al usuario.
 */
const PHRASE_FILLERS: Map<string, string> = new Map([
  ["o sea",                   "Frase muletilla 'o sea'"],
  ["digamos",                 "Muletilla 'digamos'"],
  ["basicamente",             "Muletilla 'básicamente'"],
  ["tipo",                    "Muletilla 'tipo' (usado como 'como')"],
  ["como que",                "Muletilla 'como que'"],
  ["en realidad",             "Frase muletilla 'en realidad'"],
  ["la verdad es que",        "Frase muletilla 'la verdad es que'"],
  ["a ver",                   "Muletilla 'a ver' (relleno)"],
  ["o bueno",                 "Muletilla 'o bueno'"],
  ["pues",                    "Muletilla 'pues'"],
  ["pues nada",               "Frase muletilla 'pues nada'"],
  ["la verdad",               "Muletilla 'la verdad'"],
  ["al final",                "Muletilla 'al final' (relleno)"],
  ["no se",                   "Muletilla 'no sé'"],
  ["no se si",                "Frase muletilla 'no sé si'"],
  ["que se yo",               "Muletilla 'que sé yo'"],
  ["como decirte",            "Muletilla 'cómo decirte'"],
  ["como decir",              "Muletilla 'cómo decir'"],
  ["osea",                    "Muletilla 'o sea' (junto)"],
  ["o sea que",               "Frase muletilla 'o sea que'"],
  ["en fin",                  "Muletilla 'en fin'"],
  ["bueno pues",              "Frase muletilla 'bueno pues'"],
  ["total que",               "Muletilla 'total que'"],
  ["eso si",                  "Muletilla 'eso sí'"],
  ["claro que si",            "Muletilla 'claro que sí'"],
]);

/**
 * Palabras ambiguas: pueden ser muletilla O conector válido.
 * Se evalúan con heurísticas de contexto.
 */
const AMBIGUOUS_WORDS = new Map<string, string>([
  ["entonces",   "Puede ser muletilla de inicio de frase"],
  ["bueno",      "Puede ser muletilla o afirmación"],
  ["claro",      "Puede ser muletilla o afirmación"],
  ["verdad",     "Puede ser muletilla o afirmación"],
  ["vale",       "Puede ser muletilla o afirmación"],
  ["venga",      "Puede ser muletilla o afirmación"],
  ["mira",       "Puede ser muletilla de inicio"],
  ["oye",        "Puede ser muletilla de inicio"],
  ["vamos",      "Puede ser muletilla o imperativo"],
  ["hombre",     "Puede ser muletilla o vocativo"],
  ["mujer",      "Puede ser muletilla o vocativo"],
  ["tio",        "Puede ser muletilla (coloquial) o sustantivo"],
  ["tia",        "Puede ser muletilla (coloquial) o sustantivo"],
]);

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades internas
// ─────────────────────────────────────────────────────────────────────────────

/** Normaliza una palabra: lowercase + quita puntuación final/inicial */
function normalize(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita diacríticos: á→a, é→e, etc.
    .replace(/^[¿¡"'([\]]+|[.,!?;:"'\])]+$/g, "")
    .trim();
}

/** Genera un ID determinista para una detección */
function makeDetectionId(subtitleId: string, idx: number): string {
  return `filler-${subtitleId}-${idx}`;
}

/** Extrae el texto de un rango de palabras normalizadas (para comparar con frases) */
function wordsSliceNormalized(
  words: SubtitleWord[],
  from: number,
  length: number,
): string {
  return words
    .slice(from, from + length)
    .map((w) => normalize(w.text))
    .join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring contextual para palabras ambiguas
// ─────────────────────────────────────────────────────────────────────────────

interface AmbiguousContext {
  pauseBefore: number;   // segundos
  pauseAfter: number;    // segundos
  wordDuration: number;  // segundos
  avgWordDuration: number;
  freqPerMinute: number;
  isFirstWordInSegment: boolean;
}

function scoreAmbiguous(ctx: AmbiguousContext, thresholdMs: number): number {
  const pauseThreshold = thresholdMs / 1000;
  let score = 0;

  // Pausa antes: hesitación antes de decir la muletilla
  if (ctx.pauseBefore > pauseThreshold + 0.2) {
    score += 0.35;
  } else if (ctx.pauseBefore > pauseThreshold) {
    score += 0.25;
  }

  // Pausa después: el hablante "buscaba" la siguiente idea
  if (ctx.pauseAfter > pauseThreshold) {
    score += 0.20;
  } else if (ctx.pauseAfter > pauseThreshold * 0.67) {
    score += 0.10;
  }

  // Duración prolongada → alargamiento de hesitación
  if (ctx.avgWordDuration > 0 && ctx.wordDuration > ctx.avgWordDuration * 1.5) {
    score += 0.15;
  }

  // Alta frecuencia en la grabación → patrón de habla
  if (ctx.freqPerMinute >= 4) {
    score += 0.20;
  } else if (ctx.freqPerMinute >= 2) {
    score += 0.10;
  }

  // Primera palabra del segmento = más probable que sea relleno
  if (ctx.isFirstWordInSegment) {
    score += 0.15;
  }

  return Math.min(score, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecta muletillas en la lista de subtítulos del proyecto.
 *
 * Sólo procesa subtítulos que tengan `words` con timestamps; los demás
 * se ignoran silenciosamente.
 *
 * @param subtitles  Array de Subtitle del proyecto (timeline.subtitles).
 * @param config     Configuración opcional del detector.
 */
export function detectFillers(
  subtitles: readonly Subtitle[],
  config: FillerDetectorConfig = {},
): FillerDetectionResult {
  const {
    customFillers = [],
    ambiguousThreshold = 0.45,
    pauseThresholdMs = 300,
    repetitionMinCount = 2,
  } = config;

  // Construir mapa de frases custom (normalizadas)
  const customSet = new Set(customFillers.map(normalize));

  const detections: FillerDetection[] = [];

  // Pre-calcular duración total y frecuencias de palabras ambiguas (global)
  const allWords = subtitles.flatMap((s) => s.words ?? []);
  const totalDurationSecs =
    allWords.length >= 2
      ? allWords[allWords.length - 1].endTime - allWords[0].startTime
      : 0;
  const totalMinutes = totalDurationSecs / 60 || 1;

  // Contar frecuencias globales de palabras ambiguas
  const ambiguousFreq: Map<string, number> = new Map();
  for (const w of allWords) {
    const norm = normalize(w.text);
    if (AMBIGUOUS_WORDS.has(norm)) {
      ambiguousFreq.set(norm, (ambiguousFreq.get(norm) ?? 0) + 1);
    }
  }

  // Calcular duración media de palabra (para el bonus de alargamiento)
  const avgWordDuration =
    allWords.length > 0
      ? allWords.reduce((sum, w) => sum + (w.endTime - w.startTime), 0) /
        allWords.length
      : 0.2;

  // Tamaños de frases a buscar (desc para que las frases largas tengan prioridad)
  const maxPhraseLen = 5;

  for (const subtitle of subtitles) {
    const words = subtitle.words;
    if (!words || words.length === 0) continue;

    // Marcamos qué índices ya fueron capturados para no duplicar
    const consumed = new Set<number>();
    let i = 0;

    while (i < words.length) {
      if (consumed.has(i)) {
        i++;
        continue;
      }

      const word = words[i];
      const norm = normalize(word.text);

      // Cálculo de pausas locales
      const prevWord = i > 0 ? words[i - 1] : null;
      const nextWord = i < words.length - 1 ? words[i + 1] : null;
      const pauseBefore = prevWord ? Math.max(0, word.startTime - prevWord.endTime) : 0;
      const pauseAfter = nextWord ? Math.max(0, nextWord.startTime - word.endTime) : 0;

      // ── 1. Repeticiones (antes de cualquier otra categoría) ──────────────
      if (!consumed.has(i) && i + 1 < words.length) {
        const normNext = normalize(words[i + 1].text);
        if (norm === normNext && norm.length > 1) {
          let repEnd = i + 1;
          while (repEnd + 1 < words.length && normalize(words[repEnd + 1].text) === norm) {
            repEnd++;
          }
          const repCount = repEnd - i + 1;
          if (repCount >= repetitionMinCount) {
            const lastW = words[repEnd];
            const indices = Array.from({ length: repCount }, (_, k) => i + k);
            indices.forEach((idx) => consumed.add(idx));
            detections.push({
              id: makeDetectionId(subtitle.id, detections.length),
              category: "repetition",
              text: words.slice(i, repEnd + 1).map((w) => w.text).join(" "),
              startTime: word.startTime,
              endTime: lastW.endTime,
              confidence: 0.93,
              subtitleId: subtitle.id,
              wordIndices: indices,
              reason: `"${norm}" repetida ${repCount} veces consecutivas`,
              pauseBefore,
              pauseAfter: Math.max(0, (words[repEnd + 1]?.startTime ?? lastW.endTime) - lastW.endTime),
            });
            i = repEnd + 1;
            continue;
          }
        }
      }

      // ── 2. Frases muletilla (ventana deslizante de mayor a menor longitud) ──
      // len >= 1 para capturar también frases de una sola palabra en PHRASE_FILLERS
      // (digamos, básicamente, pues…). Los sonidos (eh, um) se comprueban en el
      // paso 3 y no están en PHRASE_FILLERS, así que no hay colisión.
      let matchedPhrase = false;
      for (let len = Math.min(maxPhraseLen, words.length - i); len >= 1; len--) {
        const slice = wordsSliceNormalized(words, i, len);
        const phraseReason =
          PHRASE_FILLERS.get(slice) ?? (customSet.has(slice) ? `Muletilla personalizada "${slice}"` : null);

        if (phraseReason !== null) {
          const lastPhraseWord = words[i + len - 1];
          const indices = Array.from({ length: len }, (_, k) => i + k);
          indices.forEach((idx) => consumed.add(idx));
          detections.push({
            id: makeDetectionId(subtitle.id, detections.length),
            category: "phrase",
            text: words.slice(i, i + len).map((w) => w.text).join(" "),
            startTime: word.startTime,
            endTime: lastPhraseWord.endTime,
            confidence: 0.92,
            subtitleId: subtitle.id,
            wordIndices: indices,
            reason: phraseReason,
            pauseBefore,
            pauseAfter: Math.max(
              0,
              (words[i + len]?.startTime ?? lastPhraseWord.endTime) - lastPhraseWord.endTime,
            ),
          });
          i += len;
          matchedPhrase = true;
          break;
        }
      }
      if (matchedPhrase) continue;

      // ── 3. Sonido de duda / muletilla exacta de una palabra ─────────────
      if (SOUND_FILLERS.has(norm) || customSet.has(norm)) {
        consumed.add(i);
        detections.push({
          id: makeDetectionId(subtitle.id, detections.length),
          category: "sound",
          text: word.text,
          startTime: word.startTime,
          endTime: word.endTime,
          confidence: 0.95,
          subtitleId: subtitle.id,
          wordIndices: [i],
          reason: `Sonido de duda "${norm}"`,
          pauseBefore,
          pauseAfter,
        });
        i++;
        continue;
      }

      // ── 4. Palabras ambiguas (entonces, bueno, etc.) ─────────────────────
      const ambiguousReason = AMBIGUOUS_WORDS.get(norm);
      if (ambiguousReason) {
        const freq = (ambiguousFreq.get(norm) ?? 0) / totalMinutes;
        const ctx: AmbiguousContext = {
          pauseBefore,
          pauseAfter,
          wordDuration: word.endTime - word.startTime,
          avgWordDuration,
          freqPerMinute: freq,
          isFirstWordInSegment: i === 0,
        };
        const score = scoreAmbiguous(ctx, pauseThresholdMs);
        if (score >= ambiguousThreshold) {
          consumed.add(i);
          detections.push({
            id: makeDetectionId(subtitle.id, detections.length),
            category: "ambiguous",
            text: word.text,
            startTime: word.startTime,
            endTime: word.endTime,
            confidence: score,
            subtitleId: subtitle.id,
            wordIndices: [i],
            reason: `${ambiguousReason} (score ${(score * 100).toFixed(0)}%)`,
            pauseBefore,
            pauseAfter,
          });
        }
        i++;
        continue;
      }

      i++;
    }
  }

  // Ordenar por tiempo de inicio
  detections.sort((a, b) => a.startTime - b.startTime);

  // ── Estadísticas ─────────────────────────────────────────────────────────
  const byCategory: Record<FillerCategory, number> = {
    sound: 0,
    phrase: 0,
    repetition: 0,
    ambiguous: 0,
  };
  const textFreq: Map<string, number> = new Map();
  let totalFillerDuration = 0;

  for (const d of detections) {
    byCategory[d.category]++;
    const key = normalize(d.text);
    textFreq.set(key, (textFreq.get(key) ?? 0) + 1);
    totalFillerDuration += d.endTime - d.startTime;
  }

  const mostCommon = [...textFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([text]) => text);

  return {
    detections,
    stats: {
      byCategory,
      mostCommon,
      totalDuration: totalFillerDuration,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers públicos de utilidad
// ─────────────────────────────────────────────────────────────────────────────

/** Color de marcador de timeline por categoría */
export const FILLER_MARKER_COLORS: Record<FillerCategory, string> = {
  sound:      "#ef4444", // rojo
  phrase:     "#f97316", // naranja
  repetition: "#8b5cf6", // violeta
  ambiguous:  "#eab308", // amarillo
};

/** Etiquetas legibles por categoría */
export const FILLER_CATEGORY_LABELS: Record<FillerCategory, string> = {
  sound:      "Sonido",
  phrase:     "Frase",
  repetition: "Repetición",
  ambiguous:  "Ambiguo",
};

/** Formatea un timestamp de segundos como "0:05.3" */
export function formatFillerTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

/**
 * Devuelve las muletillas que contiene una detección agrupadas por texto.
 * Útil para mostrar "bueno × 4" en la UI.
 */
export function groupDetectionsByText(
  detections: readonly FillerDetection[],
): Map<string, FillerDetection[]> {
  const map = new Map<string, FillerDetection[]>();
  for (const d of detections) {
    const key = normalize(d.text);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return map;
}

/** Devuelve las listas base de muletillas para que el UI pueda mostrarlas */
export function getBuiltinFillerLists() {
  return {
    sounds: [...SOUND_FILLERS],
    phrases: [...PHRASE_FILLERS.keys()],
    ambiguous: [...AMBIGUOUS_WORDS.keys()],
  };
}
