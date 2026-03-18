/**
 * Google AI Client (Gemini + Imagen)
 *
 * Uses the Google Generative Language API (AI Studio key — starts with "AIza…").
 * No server needed — runs entirely from the browser.
 *
 * Text  → Gemini 2.0 Flash   (fast, cheap, multilingual)
 * Image → Imagen 3 via Gemini 2.0 Flash image-generation endpoint
 *
 * Get a free key at: https://aistudio.google.com/apikey
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface GoogleAiTextResult {
  success: boolean;
  text?: string;
  error?: string;
  model?: string;
}

export interface GoogleAiImageResult {
  success: boolean;
  /** Base64 data URL: "data:image/png;base64,..." */
  dataUrl?: string;
  mimeType?: string;
  error?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// GoogleAiClient
// ──────────────────────────────────────────────────────────────────────────────

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GoogleAiClient {
  constructor(private readonly apiKey: string) {}

  // ── Text generation ────────────────────────────────────────────────────────

  async generateText(
    prompt: string,
    model = "gemini-2.0-flash",
  ): Promise<GoogleAiTextResult> {
    try {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${err}` };
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        modelVersion?: string;
      };

      const text =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

      return { success: true, text, model: data.modelVersion ?? model };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }

  // ── Image generation (Imagen 3 via Gemini 2.0 Flash image-gen) ─────────────

  async generateImage(
    prompt: string,
    options: {
      /**
       * Default: "gemini-2.0-flash-preview-image-generation" (free AI Studio key).
       * Use "imagen-3.0-generate-002" only if you have Google Cloud billing enabled.
       */
      model?: string;
      /** 1–4. Default: 1 */
      sampleCount?: number;
      /** "1:1" | "9:16" | "16:9" | "3:4" | "4:3". Default: "16:9" */
      aspectRatio?: string;
    } = {},
  ): Promise<GoogleAiImageResult> {
    const {
      model = "gemini-2.0-flash-preview-image-generation",
      sampleCount = 1,
      aspectRatio = "16:9",
    } = options;

    // If the default Gemini model is requested, skip the Imagen 3 endpoint entirely
    if (model === "gemini-2.0-flash-preview-image-generation") {
      return this.generateImageWithGemini(prompt);
    }

    try {
      // Imagen 3 uses the :predict endpoint
      const url = `${GEMINI_BASE}/${model}:predict?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount,
            aspectRatio,
            safetySetting: "block_only_high",
            personGeneration: "allow_adult",
          },
        }),
      });

      if (!res.ok) {
        // Imagen 3 requires billing enabled in Google Cloud.
        // Fallback to Gemini 2.0 Flash image-gen (works with free AI Studio keys) on ANY error.
        return this.generateImageWithGemini(prompt);
      }

      const data = (await res.json()) as {
        predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
      };

      const prediction = data.predictions?.[0];
      if (!prediction?.bytesBase64Encoded) {
        return { success: false, error: "No image returned from Imagen 3" };
      }

      const mimeType = prediction.mimeType ?? "image/png";
      return {
        success: true,
        dataUrl: `data:${mimeType};base64,${prediction.bytesBase64Encoded}`,
        mimeType,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }

  /** Fallback: Gemini 2.0 Flash Experimental image generation */
  private async generateImageWithGemini(
    prompt: string,
  ): Promise<GoogleAiImageResult> {
    try {
      const model = "gemini-2.0-flash-preview-image-generation";
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${this.apiKey}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, error: `Gemini image gen HTTP ${res.status}: ${errText}` };
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: { mimeType?: string; data?: string };
              text?: string;
            }>;
          };
        }>;
      };

      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p) => p.inlineData?.data);

      if (!imagePart?.inlineData?.data) {
        return { success: false, error: "Gemini no devolvió imagen" };
      }

      const mimeType = imagePart.inlineData.mimeType ?? "image/png";
      return {
        success: true,
        dataUrl: `data:${mimeType};base64,${imagePart.inlineData.data}`,
        mimeType,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Quick connectivity check — returns true if key is valid */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const result = await this.generateText("Reply with one word: OK", "gemini-2.0-flash");
    if (result.success && result.text?.includes("OK")) return { ok: true };
    return { ok: false, error: result.error ?? "Unexpected response" };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Key management (localStorage — never leaves the browser)
// ──────────────────────────────────────────────────────────────────────────────

const GOOGLE_KEY_STORAGE = "videoforge_google_ai_key";

export function getStoredGoogleApiKey(): string | null {
  try {
    return localStorage.getItem(GOOGLE_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function saveGoogleApiKey(key: string): void {
  try {
    localStorage.setItem(GOOGLE_KEY_STORAGE, key.trim());
  } catch {
    /* noop */
  }
}

export function clearGoogleApiKey(): void {
  try {
    localStorage.removeItem(GOOGLE_KEY_STORAGE);
  } catch {
    /* noop */
  }
}

/** Returns a client using the stored Google AI key, or null if not set. */
export function getGoogleAiClient(): GoogleAiClient | null {
  const key = getStoredGoogleApiKey();
  if (!key) return null;
  return new GoogleAiClient(key);
}

// ──────────────────────────────────────────────────────────────────────────────
// AI provider abstraction — used by the pipeline runner
// ──────────────────────────────────────────────────────────────────────────────

export type AiProvider = "google" | "openrouter";

/** Returns which AI provider is currently configured (prefers Google if both set) */
export function getActiveAiProvider(): AiProvider | null {
  if (getStoredGoogleApiKey()) return "google";
  try {
    if (localStorage.getItem("videoforge_openrouter_key")) return "openrouter";
  } catch {
    /* noop */
  }
  return null;
}
