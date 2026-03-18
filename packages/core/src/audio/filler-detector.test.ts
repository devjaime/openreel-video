/**
 * Tests unitarios para FillerDetector
 *
 * Ejecutar con:  pnpm --filter @openreel/core test
 *
 * Casos cubiertos:
 *  - Sonidos de duda: eh, um, mmm, etc.
 *  - Frases muletilla exactas: "o sea", "digamos", "básicamente"
 *  - Frases multi-palabra: "la verdad es que", "como que"
 *  - Repeticiones: misma palabra 2+ veces seguidas
 *  - Ambiguos con contexto: "entonces" CON pausa → muletilla
 *  - Ambiguos sin contexto: "entonces" SIN pausa → NO muletilla
 *  - Muletillas personalizadas del usuario
 *  - Diacríticos: básicamente == basicamente
 *  - Puntuación adjunta: "eh," "um." → detectados igual
 *  - Input vacío / sin words → resultado vacío
 *  - Estadísticas correctas (byCategory, mostCommon, totalDuration)
 *  - Prioridad frase > sonido (overlap)
 *  - "bueno" como muletilla si alta frecuencia y posición inicial
 *  - "bueno" NO como muletilla si aparece solo una vez sin pausa
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  detectFillers,
  type FillerDetectorConfig,
  type FillerDetection,
} from "./filler-detector";
import type { Subtitle, SubtitleWord } from "../types/timeline";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de construcción de fixtures
// ─────────────────────────────────────────────────────────────────────────────

let _subId = 0;
let _wordCounter = 0;

function resetCounters() {
  _subId = 0;
  _wordCounter = 0;
}

function word(text: string, startTime: number, endTime: number): SubtitleWord {
  _wordCounter++;
  return { text, startTime, endTime };
}

/**
 * Construye una secuencia de palabras con timestamps consecutivos.
 * Por defecto cada palabra dura `wordDur` segundos con `gap` entre ellas.
 */
function words(
  texts: string[],
  startAt = 0,
  wordDur = 0.3,
  gap = 0.05,
): SubtitleWord[] {
  let t = startAt;
  return texts.map((text) => {
    const w = word(text, t, t + wordDur);
    t += wordDur + gap;
    return w;
  });
}

function subtitle(
  words: SubtitleWord[],
  extraProps: Partial<Subtitle> = {},
): Subtitle {
  _subId++;
  const text = words.map((w) => w.text).join(" ");
  const startTime = words[0]?.startTime ?? 0;
  const endTime = words[words.length - 1]?.endTime ?? 0;
  return {
    id: `sub-${_subId}`,
    text,
    startTime,
    endTime,
    words,
    ...extraProps,
  };
}

/** Crea un subtitle con pausa larga (0.6s) antes de la palabra en `pauseAt`. */
function withLongPauseBefore(
  texts: string[],
  pauseAt: number,
  pauseSecs = 0.6,
): SubtitleWord[] {
  let t = 0;
  return texts.map((text, i) => {
    if (i === pauseAt) t += pauseSecs; // pausa antes de esta palabra
    const w = word(text, t, t + 0.3);
    t += 0.3 + 0.05;
    return w;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("FillerDetector — sonidos de duda", () => {
  beforeEach(() => resetCounters());

  it("detecta 'eh' como sonido de duda", () => {
    const subs = [subtitle(words(["quiero", "eh", "decirte", "algo"]))];
    const { detections } = detectFillers(subs);
    expect(detections).toHaveLength(1);
    expect(detections[0].category).toBe("sound");
    expect(detections[0].text).toBe("eh");
    expect(detections[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detecta 'um' y 'mmm' en la misma transcripción", () => {
    const subs = [
      subtitle(words(["um", "no", "mmm", "sé"])),
    ];
    const { detections } = detectFillers(subs);
    const cats = detections.map((d) => d.text.toLowerCase());
    expect(cats).toContain("um");
    expect(cats).toContain("mmm");
    expect(detections.every((d) => d.category === "sound")).toBe(true);
  });

  it("detecta 'ah' con puntuación adjunta: 'ah,'", () => {
    const subs = [subtitle(words(["ah,", "entonces", "me", "lo", "dijiste"]))];
    const { detections } = detectFillers(subs);
    const sounds = detections.filter((d) => d.category === "sound");
    expect(sounds.length).toBeGreaterThanOrEqual(1);
    expect(sounds[0].text).toBe("ah,");
  });

  it("detecta 'uh' con puntuación adjunta: 'uh.'", () => {
    const subs = [subtitle(words(["uh.", "sí", "claro"]))];
    const { detections } = detectFillers(subs);
    expect(detections.some((d) => d.category === "sound")).toBe(true);
  });

  it("no detecta palabras normales como sonido", () => {
    const subs = [subtitle(words(["hola", "me", "llamo", "carlos"]))];
    const { detections } = detectFillers(subs);
    expect(detections.filter((d) => d.category === "sound")).toHaveLength(0);
  });
});

describe("FillerDetector — frases muletilla", () => {
  beforeEach(() => resetCounters());

  it("detecta 'o sea' como frase (2 palabras)", () => {
    // Evitamos "al final" en las palabras siguientes porque también es frase en PHRASE_FILLERS
    const subs = [subtitle(words(["o", "sea", "quiero", "contarte"]))];
    const { detections } = detectFillers(subs);
    const phrases = detections.filter((d) => d.category === "phrase");
    expect(phrases).toHaveLength(1);
    expect(phrases[0].text.toLowerCase()).toBe("o sea");
    expect(phrases[0].wordIndices).toEqual([0, 1]);
  });

  it("detecta 'digamos' como frase de una palabra", () => {
    const subs = [subtitle(words(["digamos", "que", "funciona"]))];
    const { detections } = detectFillers(subs);
    expect(detections.some((d) => d.text === "digamos")).toBe(true);
  });

  it("detecta 'básicamente' con diacrítico (normalizado a 'basicamente')", () => {
    const subs = [subtitle(words(["básicamente", "es", "así"]))];
    const { detections } = detectFillers(subs);
    expect(detections.some((d) => normalize_test(d.text) === "basicamente")).toBe(true);
  });

  it("detecta 'la verdad es que' como frase de 4 palabras", () => {
    const subs = [
      subtitle(words(["la", "verdad", "es", "que", "me", "gustó"])),
    ];
    const { detections } = detectFillers(subs);
    const phrases = detections.filter((d) => d.category === "phrase");
    expect(phrases.length).toBeGreaterThanOrEqual(1);
    const longPhrase = phrases.find((d) => d.wordIndices.length === 4);
    expect(longPhrase).toBeDefined();
    expect(longPhrase!.text.toLowerCase()).toBe("la verdad es que");
  });

  it("detecta 'como que' correctamente", () => {
    const subs = [subtitle(words(["es", "como", "que", "imposible"]))];
    const { detections } = detectFillers(subs);
    expect(detections.some((d) => d.text.toLowerCase() === "como que")).toBe(true);
  });

  it("detecta 'a ver' como frase muletilla", () => {
    const subs = [subtitle(words(["a", "ver", "déjame", "pensar"]))];
    const { detections } = detectFillers(subs);
    expect(detections.some((d) => d.text.toLowerCase() === "a ver")).toBe(true);
  });

  it("frase larga tiene prioridad sobre subconjunto: 'la verdad es que' > 'la verdad'", () => {
    const subs = [
      subtitle(words(["la", "verdad", "es", "que", "sí"])),
    ];
    const { detections } = detectFillers(subs);
    const texts = detections.map((d) => d.text.toLowerCase());
    // No debe haber DOS detecciones que se solapen (la frase larga ya consume las palabras)
    const hasLong = texts.some((t) => t === "la verdad es que");
    const hasShort = texts.some((t) => t === "la verdad");
    expect(hasLong || hasShort).toBe(true);
    // Solo una de las dos debe estar
    expect(hasLong && hasShort).toBe(false);
  });
});

describe("FillerDetector — repeticiones", () => {
  beforeEach(() => resetCounters());

  it("detecta 'que que' como repetición", () => {
    const subs = [subtitle(words(["que", "que", "no", "sé"]))];
    const { detections } = detectFillers(subs);
    const reps = detections.filter((d) => d.category === "repetition");
    expect(reps).toHaveLength(1);
    expect(reps[0].wordIndices).toEqual([0, 1]);
  });

  it("detecta triple repetición: 'básicamente básicamente básicamente'", () => {
    const subs = [
      subtitle(words(["básicamente", "básicamente", "básicamente", "sí"])),
    ];
    const { detections } = detectFillers(subs);
    const reps = detections.filter((d) => d.category === "repetition");
    expect(reps).toHaveLength(1);
    expect(reps[0].wordIndices).toHaveLength(3);
  });

  it("no marca como repetición palabras diferentes consecutivas", () => {
    const subs = [subtitle(words(["hola", "mundo", "hola", "amigos"]))];
    const { detections } = detectFillers(subs);
    const reps = detections.filter((d) => d.category === "repetition");
    expect(reps).toHaveLength(0);
  });

  it("repetición normalizada: 'Es es' → detecta a pesar del caso diferente", () => {
    const subs = [subtitle(words(["Es", "es", "correcto"]))];
    const { detections } = detectFillers(subs);
    const reps = detections.filter((d) => d.category === "repetition");
    expect(reps).toHaveLength(1);
  });

  it("no marca artículos de una letra como repetición (word.length > 1)", () => {
    // "a a" no debería marcarse porque 'a' tiene longitud 1 después de normalizar
    const subs = [subtitle(words(["a", "a", "ver"]))];
    const { detections } = detectFillers(subs);
    // 'a ver' será frase, no repetición de 'a'
    const reps = detections.filter((d) => d.category === "repetition");
    expect(reps).toHaveLength(0);
  });
});

describe("FillerDetector — palabras ambiguas con contexto", () => {
  beforeEach(() => resetCounters());

  it("'entonces' CON pausa larga antes → muletilla (ambiguous)", () => {
    // Pausa de 0.6s antes de "entonces" (threshold por defecto: 300ms)
    const ws = withLongPauseBefore(["y", "entonces", "dije"], 1, 0.6);
    const subs = [subtitle(ws)];
    const cfg: FillerDetectorConfig = { ambiguousThreshold: 0.40 };
    const { detections } = detectFillers(subs, cfg);
    const ambig = detections.filter((d) => d.category === "ambiguous");
    expect(ambig.some((d) => d.text === "entonces")).toBe(true);
  });

  it("'entonces' SIN pausa + baja frecuencia → NO marcado", () => {
    // Palabras fluidas sin pausa, "entonces" aparece 1 sola vez
    const subs = [subtitle(words(["y", "entonces", "el", "proyecto", "creció"]))];
    const { detections } = detectFillers(subs, { ambiguousThreshold: 0.45 });
    const ambig = detections.filter(
      (d) => d.category === "ambiguous" && d.text === "entonces",
    );
    expect(ambig).toHaveLength(0);
  });

  it("'bueno' con pausa larga antes Y después → ambiguous detectado", () => {
    // Construimos manualmente los timestamps para controlar ambas pausas:
    //   "algo"  0.0–0.3  (palabra previa)
    //   [pausa 0.6 s]
    //   "bueno" 0.9–1.2  (pauseBefore=0.6 > 0.5 → +0.35)
    //   [pausa 0.4 s]
    //   "como"  1.6–1.9  (pauseAfter=0.4 > 0.3 → +0.20)
    //   score total = 0.55 > 0.45 (threshold por defecto)
    const ws: SubtitleWord[] = [
      word("algo",  0.0, 0.3),
      word("bueno", 0.9, 1.2),
      word("como",  1.6, 1.9),
      word("te",    1.95, 2.25),
      word("decía", 2.3, 2.6),
    ];
    const subs = [subtitle(ws)];
    const { detections } = detectFillers(subs);
    const ambig = detections.filter((d) => d.category === "ambiguous");
    expect(ambig.some((d) => d.text === "bueno")).toBe(true);
  });

  it("'bueno' alta frecuencia → ambiguous detectado aunque sin pausa", () => {
    // Aparece 6 veces en una grabación de ~1 minuto → 6/min > umbral de 4/min
    const ws: SubtitleWord[] = [];
    for (let i = 0; i < 6; i++) {
      ws.push(word("bueno", i * 10, i * 10 + 0.3));
      ws.push(word("algo", i * 10 + 0.4, i * 10 + 0.7));
    }
    const subs = [subtitle(ws)];
    const { detections } = detectFillers(subs, {
      ambiguousThreshold: 0.20, // bajo para este caso de frecuencia alta
    });
    const ambig = detections.filter((d) => d.category === "ambiguous");
    expect(ambig.length).toBeGreaterThan(0);
  });

  it("'claro' SIN pausa y sin frecuencia → NO marcado", () => {
    const subs = [subtitle(words(["es", "claro", "que", "sí"]))];
    const { detections } = detectFillers(subs);
    const ambig = detections.filter(
      (d) => d.category === "ambiguous" && d.text === "claro",
    );
    expect(ambig).toHaveLength(0);
  });
});

describe("FillerDetector — muletillas personalizadas", () => {
  beforeEach(() => resetCounters());

  it("detecta muletilla personalizada de una palabra", () => {
    const subs = [subtitle(words(["mirá", "lo", "que", "te", "digo"]))];
    const { detections } = detectFillers(subs, { customFillers: ["mirá"] });
    // "mirá" normalizado → "mira" que coincide con la lista custom
    expect(detections.some((d) => d.category === "sound" || d.category === "phrase")).toBe(true);
  });

  it("detecta muletilla personalizada con diacrítico", () => {
    const subs = [subtitle(words(["esteee", "sí", "lo", "hago"]))];
    const { detections } = detectFillers(subs, { customFillers: ["esteee"] });
    expect(detections.length).toBeGreaterThanOrEqual(1);
  });
});

describe("FillerDetector — inputs edge cases", () => {
  beforeEach(() => resetCounters());

  it("array vacío de subtítulos → resultado vacío", () => {
    const { detections, stats } = detectFillers([]);
    expect(detections).toHaveLength(0);
    expect(stats.totalDuration).toBe(0);
  });

  it("subtítulos sin words → ignorados sin errores", () => {
    const subs: Subtitle[] = [
      {
        id: "sub-1",
        text: "hola eh mundo",
        startTime: 0,
        endTime: 3,
        words: undefined,
      },
    ];
    expect(() => detectFillers(subs)).not.toThrow();
    const { detections } = detectFillers(subs);
    expect(detections).toHaveLength(0);
  });

  it("subtítulo con words vacío → ignorado", () => {
    const subs: Subtitle[] = [
      { id: "sub-1", text: "", startTime: 0, endTime: 1, words: [] },
    ];
    const { detections } = detectFillers(subs);
    expect(detections).toHaveLength(0);
  });

  it("una sola palabra que es muletilla", () => {
    const subs = [subtitle([word("eh", 0, 0.3)])];
    const { detections } = detectFillers(subs);
    expect(detections).toHaveLength(1);
    expect(detections[0].category).toBe("sound");
  });
});

describe("FillerDetector — estadísticas", () => {
  beforeEach(() => resetCounters());

  it("byCategory cuenta correctamente cada categoría", () => {
    // Nota: "o sea que" está en PHRASE_FILLERS como frase de 3 palabras, lo que
    // consumiría el primer "que" antes de que se detecte la repetición "que que".
    // Usamos un orden donde no se forma accidentalmente esa frase más larga:
    // ["eh"]=sonido, ["digamos"]=frase, ["que","que"]=repetición, ["o","sea"]=frase
    const subs = [
      subtitle(words(["eh", "digamos", "que", "que", "o", "sea"])),
    ];
    const { stats } = detectFillers(subs);
    expect(stats.byCategory.sound).toBeGreaterThanOrEqual(1);        // eh
    expect(stats.byCategory.phrase).toBeGreaterThanOrEqual(1);       // digamos, o sea
    expect(stats.byCategory.repetition).toBeGreaterThanOrEqual(1);   // que que
  });

  it("totalDuration es la suma de duraciones de todas las muletillas", () => {
    const subs = [subtitle(words(["eh", "normal", "um"], 0, 0.3, 0.05))];
    const { detections, stats } = detectFillers(subs);
    const expected = detections.reduce(
      (sum, d) => sum + (d.endTime - d.startTime),
      0,
    );
    expect(stats.totalDuration).toBeCloseTo(expected, 4);
  });

  it("mostCommon tiene como máximo 5 elementos", () => {
    const subs = [
      subtitle(
        words([
          "eh", "um", "ah", "mmm", "digamos",
          "o", "sea", "pues", "vale", "entonces",
        ]),
      ),
    ];
    const { stats } = detectFillers(subs);
    expect(stats.mostCommon.length).toBeLessThanOrEqual(5);
  });

  it("detections están ordenadas por startTime ascendente", () => {
    const subs = [
      subtitle(words(["um", "o", "sea", "eh", "digamos"])),
    ];
    const { detections } = detectFillers(subs);
    for (let i = 1; i < detections.length; i++) {
      expect(detections[i].startTime).toBeGreaterThanOrEqual(
        detections[i - 1].startTime,
      );
    }
  });
});

describe("FillerDetector — múltiples subtítulos", () => {
  beforeEach(() => resetCounters());

  it("detecta muletillas en distintos subtítulos", () => {
    const subs = [
      subtitle(words(["hola", "eh", "mundo"], 0)),
      subtitle(words(["um", "sí", "claro"], 5)),
    ];
    const { detections } = detectFillers(subs);
    const subIds = new Set(detections.map((d) => d.subtitleId));
    expect(subIds.size).toBe(2);
  });

  it("detections referencia el subtitleId correcto", () => {
    const s1 = subtitle(words(["eh"], 0));
    const s2 = subtitle(words(["um"], 5));
    const { detections } = detectFillers([s1, s2]);
    const d1 = detections.find((d) => d.text === "eh");
    const d2 = detections.find((d) => d.text === "um");
    expect(d1?.subtitleId).toBe(s1.id);
    expect(d2?.subtitleId).toBe(s2.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper de test (copia local de normalize para las aserciones)
// ─────────────────────────────────────────────────────────────────────────────
function normalize_test(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[¿¡"'([\]]+|[.,!?;:"'\])]+$/g, "")
    .trim();
}
