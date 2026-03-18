/**
 * Social Media Platform Export Presets
 *
 * Canonical data layer for every supported social platform.
 * Zero React dependencies — pure TypeScript types + data.
 *
 * Each spec covers:
 *  - Canvas resolution & frame rate
 *  - Optimal encoding settings
 *  - Safe-area insets (normalised 0-1) with named UI zones
 *  - Subtitle placement hint
 *  - Platform-specific tips
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SocialPlatformId =
  | "youtube"
  | "youtube-shorts"
  | "linkedin"
  | "instagram-reels"
  | "instagram-feed"
  | "instagram-story"
  | "tiktok"
  | "twitter"
  | "shorts"; // alias: youtube-shorts 60fps variant

/**
 * Normalised insets (0–1) from each edge of the frame.
 * Content positioned inside these bounds is guaranteed to be visible,
 * never obscured by any platform UI element.
 */
export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * A named platform-UI strip that appears on one edge of the frame.
 * `size` is the normalised dimension (height for top/bottom, width for left/right).
 */
export interface PlatformUiZone {
  /** Human-readable label shown in the overlay */
  label: string;
  /** Which edge this zone hugs */
  edge: "top" | "bottom" | "left" | "right";
  /** Normalised size of the strip (0–1) */
  size: number;
  /** Tailwind/CSS background colour token for the overlay tint */
  colorClass: string;
  /** Hex used when rendering on canvas */
  colorHex: string;
}

export type SubtitleVertical = "bottom" | "center" | "top";

export interface SubtitlePositionHint {
  /** Vertical placement zone */
  vertical: SubtitleVertical;
  /**
   * Normalised offset from the bottom edge of the *safe zone*
   * (not the full frame). 0 = very bottom of safe zone, 1 = very top.
   */
  safeZoneBottomOffset: number;
  /** Whether burning subtitles into the video is recommended */
  hardcoded: boolean;
  /** Short explanation shown in the UI */
  note: string;
}

export interface SocialPlatformEncoding {
  codec: "h264" | "h265" | "vp9";
  /** kbps */
  bitrate: number;
  bitrateMode: "vbr" | "cbr";
  keyframeInterval: number;
  /** Audio kbps */
  audioBitrate: number;
  audioSampleRate: 44100 | 48000;
}

export interface SocialPlatformSpec {
  id: SocialPlatformId;
  /** Display name */
  name: string;
  /** Unicode emoji icon */
  emoji: string;
  /** Brand hex colour */
  color: string;
  /** "16:9" | "9:16" | "1:1" */
  aspectRatio: string;
  /** Output canvas width */
  width: number;
  /** Output canvas height */
  height: number;
  /** Recommended frame rate */
  frameRate: number;
  /** Optional second frame-rate choice */
  alternateFrameRate?: number;
  /** Max duration seconds (undefined = no hard cap) */
  maxDurationSecs?: number;
  /** Max file size bytes (undefined = no hard cap) */
  maxFileSizeBytes?: number;
  /** Encoding optimisation */
  encoding: SocialPlatformEncoding;
  /** Area guaranteed to be unobscured — normalised insets from frame edges */
  safeArea: SafeAreaInsets;
  /** Named UI strips present on this platform during playback */
  uiZones: PlatformUiZone[];
  /** Where to place subtitles for this platform */
  subtitleHint: SubtitlePositionHint;
  /** Actionable tips shown in the export selector */
  tips: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform Specs
// ─────────────────────────────────────────────────────────────────────────────

export const SOCIAL_PLATFORM_SPECS: Record<SocialPlatformId, SocialPlatformSpec> = {
  // ── YouTube ────────────────────────────────────────────────────────────────
  youtube: {
    id: "youtube",
    name: "YouTube",
    emoji: "▶️",
    color: "#FF0000",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    frameRate: 30,
    alternateFrameRate: 60,
    encoding: {
      codec: "h264",
      bitrate: 15000,
      bitrateMode: "vbr",
      keyframeInterval: 60,
      audioBitrate: 384,
      audioSampleRate: 48000,
    },
    safeArea: { top: 0.05, bottom: 0.13, left: 0.02, right: 0.02 },
    uiZones: [
      {
        label: "Barra de controles",
        edge: "bottom",
        size: 0.13,
        colorClass: "bg-red-500/30",
        colorHex: "#ef444460",
      },
      {
        label: "Barra superior / título",
        edge: "top",
        size: 0.05,
        colorClass: "bg-red-500/20",
        colorHex: "#ef444440",
      },
    ],
    subtitleHint: {
      vertical: "bottom",
      safeZoneBottomOffset: 0.08,
      hardcoded: false,
      note: "Coloca subtítulos en el tercio inferior visible, por encima de los controles.",
    },
    tips: [
      "Usa H.264 para máxima compatibilidad; H.265 para menor tamaño.",
      "Sube el bitrate a 25 Mbps si el contenido tiene mucho movimiento.",
      "Los primeros 15 segundos son clave para retención.",
      "Agrega subtítulos: YouTube los prioriza para accesibilidad y SEO.",
    ],
  },

  // ── YouTube Shorts ─────────────────────────────────────────────────────────
  "youtube-shorts": {
    id: "youtube-shorts",
    name: "YouTube Shorts",
    emoji: "📱",
    color: "#FF0000",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    frameRate: 60,
    alternateFrameRate: 30,
    maxDurationSecs: 60,
    encoding: {
      codec: "h264",
      bitrate: 12000,
      bitrateMode: "vbr",
      keyframeInterval: 30,
      audioBitrate: 256,
      audioSampleRate: 48000,
    },
    safeArea: { top: 0.17, bottom: 0.32, left: 0.03, right: 0.16 },
    uiZones: [
      {
        label: "Perfil + seguir + título",
        edge: "top",
        size: 0.17,
        colorClass: "bg-red-500/30",
        colorHex: "#ef444460",
      },
      {
        label: "Descripción + barra de audio",
        edge: "bottom",
        size: 0.32,
        colorClass: "bg-red-500/30",
        colorHex: "#ef444460",
      },
      {
        label: "Acciones (like/compartir…)",
        edge: "right",
        size: 0.16,
        colorClass: "bg-orange-500/30",
        colorHex: "#f9731660",
      },
    ],
    subtitleHint: {
      vertical: "center",
      safeZoneBottomOffset: 0.4,
      hardcoded: true,
      note: "Centra los subtítulos en el área media del safe zone para evitar las barras de UI.",
    },
    tips: [
      "Máximo 60 segundos.",
      "Los primeros 3 segundos determinan si el algoritmo lo impulsa.",
      "Subtítulos burned-in mejoran la retención un ~40% (sin sonido por defecto).",
      "Evita texto o logos en el tercio superior e inferior.",
    ],
  },

  // ── Shorts (60fps alias) ────────────────────────────────────────────────────
  shorts: {
    id: "shorts",
    name: "Shorts / TikTok 60fps",
    emoji: "⚡",
    color: "#FF0000",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    frameRate: 60,
    maxDurationSecs: 60,
    encoding: {
      codec: "h264",
      bitrate: 14000,
      bitrateMode: "vbr",
      keyframeInterval: 30,
      audioBitrate: 256,
      audioSampleRate: 48000,
    },
    safeArea: { top: 0.17, bottom: 0.30, left: 0.03, right: 0.16 },
    uiZones: [
      {
        label: "Perfil + seguir",
        edge: "top",
        size: 0.17,
        colorClass: "bg-red-500/30",
        colorHex: "#ef444460",
      },
      {
        label: "Descripción + audio",
        edge: "bottom",
        size: 0.30,
        colorClass: "bg-red-500/30",
        colorHex: "#ef444460",
      },
      {
        label: "Botones acción",
        edge: "right",
        size: 0.16,
        colorClass: "bg-orange-500/30",
        colorHex: "#f9731660",
      },
    ],
    subtitleHint: {
      vertical: "center",
      safeZoneBottomOffset: 0.4,
      hardcoded: true,
      note: "Usa subtítulos animados centrados para mayor retención.",
    },
    tips: [
      "60fps da fluidez extra — ideal para contenido de movimiento rápido.",
      "Mismas restricciones de duración que YouTube Shorts.",
    ],
  },

  // ── TikTok ─────────────────────────────────────────────────────────────────
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    emoji: "🎵",
    color: "#010101",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    frameRate: 30,
    alternateFrameRate: 60,
    maxDurationSecs: 600,   // 10 min for verified; 3 min for most
    maxFileSizeBytes: 287 * 1024 * 1024,
    encoding: {
      codec: "h264",
      bitrate: 10000,
      bitrateMode: "vbr",
      keyframeInterval: 30,
      audioBitrate: 192,
      audioSampleRate: 44100,
    },
    safeArea: { top: 0.10, bottom: 0.25, left: 0.03, right: 0.14 },
    uiZones: [
      {
        label: "Perfil + barra superior",
        edge: "top",
        size: 0.10,
        colorClass: "bg-neutral-900/40",
        colorHex: "#00000060",
      },
      {
        label: "Descripción + nombre canción",
        edge: "bottom",
        size: 0.25,
        colorClass: "bg-neutral-900/50",
        colorHex: "#00000070",
      },
      {
        label: "Like / comentar / compartir",
        edge: "right",
        size: 0.14,
        colorClass: "bg-orange-500/30",
        colorHex: "#f9731650",
      },
    ],
    subtitleHint: {
      vertical: "center",
      safeZoneBottomOffset: 0.35,
      hardcoded: true,
      note: "Los subtítulos centrados en el área media duplican la retención de espectadores sin sonido.",
    },
    tips: [
      "TikTok recomprime el video — sube a la mayor calidad posible.",
      "El 90% de los usuarios mira sin sonido: subtítulos son imprescindibles.",
      "Ganchos en los primeros 2 segundos son decisivos para el algoritmo.",
      "Usa música trending para distribución orgánica.",
      "Tamaño máximo: 287 MB.",
    ],
  },

  // ── Instagram Reels ────────────────────────────────────────────────────────
  "instagram-reels": {
    id: "instagram-reels",
    name: "Instagram Reels",
    emoji: "📷",
    color: "#E1306C",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    frameRate: 30,
    maxDurationSecs: 90,
    encoding: {
      codec: "h264",
      bitrate: 8000,
      bitrateMode: "vbr",
      keyframeInterval: 60,
      audioBitrate: 192,
      audioSampleRate: 44100,
    },
    safeArea: { top: 0.10, bottom: 0.25, left: 0.03, right: 0.13 },
    uiZones: [
      {
        label: "Barra superior",
        edge: "top",
        size: 0.10,
        colorClass: "bg-pink-500/30",
        colorHex: "#ec489960",
      },
      {
        label: "Descripción + audio",
        edge: "bottom",
        size: 0.25,
        colorClass: "bg-pink-500/30",
        colorHex: "#ec489960",
      },
      {
        label: "Like / comentar / audio / compartir",
        edge: "right",
        size: 0.13,
        colorClass: "bg-orange-500/25",
        colorHex: "#f9731650",
      },
    ],
    subtitleHint: {
      vertical: "center",
      safeZoneBottomOffset: 0.30,
      hardcoded: true,
      note: "Instagram recomprime agresivamente. Subtítulos burned-in garantizan legibilidad.",
    },
    tips: [
      "Máximo 90 segundos en Reels.",
      "Instagram reduce la calidad en subidas con baja resolución — usa 1080p.",
      "El aspect ratio 9:16 ocupa toda la pantalla en el feed para móvil.",
      "Añade texto/gráficos dentro del área segura para evitar que la UI los tape.",
    ],
  },

  // ── Instagram Feed ─────────────────────────────────────────────────────────
  "instagram-feed": {
    id: "instagram-feed",
    name: "Instagram Feed",
    emoji: "🖼️",
    color: "#E1306C",
    aspectRatio: "1:1",
    width: 1080,
    height: 1080,
    frameRate: 30,
    maxDurationSecs: 60,
    encoding: {
      codec: "h264",
      bitrate: 6000,
      bitrateMode: "vbr",
      keyframeInterval: 60,
      audioBitrate: 192,
      audioSampleRate: 44100,
    },
    safeArea: { top: 0.10, bottom: 0.14, left: 0.02, right: 0.02 },
    uiZones: [
      {
        label: "Cabecera de perfil",
        edge: "top",
        size: 0.10,
        colorClass: "bg-pink-500/30",
        colorHex: "#ec489960",
      },
      {
        label: "Barra de acciones + pie",
        edge: "bottom",
        size: 0.14,
        colorClass: "bg-pink-500/25",
        colorHex: "#ec489950",
      },
    ],
    subtitleHint: {
      vertical: "bottom",
      safeZoneBottomOffset: 0.10,
      hardcoded: false,
      note: "Posiciona subtítulos en el cuarto inferior del área segura.",
    },
    tips: [
      "Formato cuadrado (1:1) es el más versátil para el feed.",
      "Máximo 60 segundos para vídeos en feed.",
      "La miniatura se muestra cuadrada — centra el sujeto principal.",
    ],
  },

  // ── Instagram Story ────────────────────────────────────────────────────────
  "instagram-story": {
    id: "instagram-story",
    name: "Instagram Story",
    emoji: "⭕",
    color: "#E1306C",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    frameRate: 30,
    maxDurationSecs: 15,
    encoding: {
      codec: "h264",
      bitrate: 6000,
      bitrateMode: "vbr",
      keyframeInterval: 30,
      audioBitrate: 128,
      audioSampleRate: 44100,
    },
    safeArea: { top: 0.14, bottom: 0.10, left: 0.03, right: 0.03 },
    uiZones: [
      {
        label: "Barra de progreso + perfil",
        edge: "top",
        size: 0.14,
        colorClass: "bg-pink-500/35",
        colorHex: "#ec489965",
      },
      {
        label: "Barra de respuesta",
        edge: "bottom",
        size: 0.10,
        colorClass: "bg-pink-500/25",
        colorHex: "#ec489945",
      },
    ],
    subtitleHint: {
      vertical: "center",
      safeZoneBottomOffset: 0.20,
      hardcoded: true,
      note: "Stories se ven sin sonido. Centra el mensaje visual dentro del safe zone.",
    },
    tips: [
      "Máximo 15 segundos por clip; las stories se dividen automáticamente.",
      "El primer segundo es decisivo — evita los logos en las esquinas superiores.",
      "Usa elementos interactivos (encuestas, links) en el centro del safe zone.",
      "Sube sin música para conservar el audio original al publicar.",
    ],
  },

  // ── Twitter / X ───────────────────────────────────────────────────────────
  twitter: {
    id: "twitter",
    name: "Twitter / X",
    emoji: "🐦",
    color: "#1DA1F2",
    aspectRatio: "16:9",
    width: 1280,
    height: 720,
    frameRate: 30,
    maxDurationSecs: 140,
    maxFileSizeBytes: 512 * 1024 * 1024,
    encoding: {
      codec: "h264",
      bitrate: 6000,
      bitrateMode: "vbr",
      keyframeInterval: 60,
      audioBitrate: 192,
      audioSampleRate: 44100,
    },
    safeArea: { top: 0.04, bottom: 0.10, left: 0.02, right: 0.02 },
    uiZones: [
      {
        label: "Controles de reproducción",
        edge: "bottom",
        size: 0.10,
        colorClass: "bg-sky-500/25",
        colorHex: "#0ea5e950",
      },
    ],
    subtitleHint: {
      vertical: "bottom",
      safeZoneBottomOffset: 0.10,
      hardcoded: false,
      note: "Twitter/X tiene UI mínima sobre el vídeo. Subtítulos en tercio inferior.",
    },
    tips: [
      "Tamaño máximo: 512 MB · duración máxima: 2 min 20 s.",
      "720p es suficiente — Twitter recomprime a 720p cualquier cosa superior.",
      "Sube MP4 H.264 para máxima compatibilidad.",
      "Los primeros 3 segundos determinan si el usuario sigue mirando.",
    ],
  },

  // ── LinkedIn ───────────────────────────────────────────────────────────────
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    emoji: "💼",
    color: "#0A66C2",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxDurationSecs: 600,
    maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
    encoding: {
      codec: "h264",
      bitrate: 10000,
      bitrateMode: "vbr",
      keyframeInterval: 60,
      audioBitrate: 256,
      audioSampleRate: 48000,
    },
    safeArea: { top: 0.06, bottom: 0.12, left: 0.02, right: 0.02 },
    uiZones: [
      {
        label: "Cabecera de publicación",
        edge: "top",
        size: 0.06,
        colorClass: "bg-blue-600/20",
        colorHex: "#2563eb40",
      },
      {
        label: "Barra de reacciones + comentarios",
        edge: "bottom",
        size: 0.12,
        colorClass: "bg-blue-600/25",
        colorHex: "#2563eb50",
      },
    ],
    subtitleHint: {
      vertical: "bottom",
      safeZoneBottomOffset: 0.08,
      hardcoded: true,
      note: "El 85% de los usuarios de LinkedIn ve vídeos sin sonido. Subtítulos burned-in son imprescindibles.",
    },
    tips: [
      "El 85% del consumo es en silencio — subtítulos hardcoded son obligatorios.",
      "Los primeros 3 segundos se muestran en bucle como preview — úsalos bien.",
      "1–2 minutos es la duración óptima para contenido profesional.",
      "Bitrate alto (8–12 Mbps) transmite calidad profesional.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns all platform specs as an ordered list for display. */
export function getAllSocialPlatforms(): SocialPlatformSpec[] {
  const ORDER: SocialPlatformId[] = [
    "youtube",
    "youtube-shorts",
    "shorts",
    "tiktok",
    "instagram-reels",
    "instagram-feed",
    "instagram-story",
    "twitter",
    "linkedin",
  ];
  return ORDER.map((id) => SOCIAL_PLATFORM_SPECS[id]);
}

/** Returns the platform spec for a given id, or undefined. */
export function getSocialPlatformSpec(
  id: SocialPlatformId,
): SocialPlatformSpec | undefined {
  return SOCIAL_PLATFORM_SPECS[id];
}

/**
 * Returns the safe-zone rectangle in *pixel* coordinates
 * for a given frame size, based on the platform's normalised safe-area insets.
 */
export function getSafeZonePixels(
  spec: SocialPlatformSpec,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; width: number; height: number } {
  const { safeArea } = spec;
  const x = safeArea.left * frameWidth;
  const y = safeArea.top * frameHeight;
  const width = frameWidth * (1 - safeArea.left - safeArea.right);
  const height = frameHeight * (1 - safeArea.top - safeArea.bottom);
  return { x, y, width, height };
}

/**
 * Returns the recommended subtitle Y position (normalised from the top of the
 * frame) for a given platform spec. Use this to pre-position the subtitle
 * track when adapting a project to a social platform.
 */
export function getSubtitleYNormalized(spec: SocialPlatformSpec): number {
  const { safeArea, subtitleHint } = spec;
  const safeBottom = 1 - safeArea.bottom;
  const safeHeight = safeBottom - safeArea.top;
  return safeBottom - safeHeight * subtitleHint.safeZoneBottomOffset;
}
