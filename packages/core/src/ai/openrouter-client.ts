/**
 * OpenRouter API Client
 *
 * Thin typed wrapper around https://openrouter.ai/api/v1 (OpenAI-compatible).
 * Used by the Magic Pipeline for:
 *  - Smart transcript analysis  → openai/gpt-4o
 *  - YouTube thumbnail generation → openai/dall-e-3
 *
 * The API key is NEVER stored here — the caller must pass it explicitly.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface OpenRouterConfig {
  apiKey: string;
  /** Defaults to https://openrouter.ai/api/v1 */
  baseUrl?: string;
  /** HTTP-Referer header required by OpenRouter */
  siteUrl?: string;
  /** X-Title header shown in OpenRouter dashboard */
  siteName?: string;
}

export interface OpenRouterTextResult {
  success: boolean;
  text?: string;
  error?: string;
  model?: string;
  tokensUsed?: number;
}

export interface OpenRouterImageResult {
  success: boolean;
  /** Base64 data URL: "data:image/png;base64,..." */
  dataUrl?: string;
  revisedPrompt?: string;
  error?: string;
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// OpenRouterClient
// ──────────────────────────────────────────────────────────────────────────────

export class OpenRouterClient {
  private readonly cfg: Required<OpenRouterConfig>;

  constructor(config: OpenRouterConfig) {
    this.cfg = {
      baseUrl: "https://openrouter.ai/api/v1",
      siteUrl: "https://github.com/devjaime/openreel-video",
      siteName: "VideoForge",
      ...config,
    };
  }

  // ── Text completion ────────────────────────────────────────────────────────

  async generateText(
    messages: OpenRouterMessage[],
    model = "openai/gpt-4o",
    maxTokens = 1024,
  ): Promise<OpenRouterTextResult> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${err}` };
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
        model?: string;
        usage?: { total_tokens?: number };
      };

      const text = data.choices?.[0]?.message?.content ?? "";
      return {
        success: true,
        text,
        model: data.model,
        tokensUsed: data.usage?.total_tokens,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  }

  /** Convenience: single user prompt → text response */
  async ask(
    prompt: string,
    model = "openai/gpt-4o",
  ): Promise<OpenRouterTextResult> {
    return this.generateText([{ role: "user", content: prompt }], model);
  }

  // ── Image generation ───────────────────────────────────────────────────────

  async generateImage(
    prompt: string,
    options: {
      model?: string;
      size?: "1024x1024" | "1792x1024" | "1024x1792";
      quality?: "standard" | "hd";
    } = {},
  ): Promise<OpenRouterImageResult> {
    const {
      model = "openai/dall-e-3",
      size = "1792x1024",
      quality = "standard",
    } = options;

    try {
      const res = await fetch(`${this.cfg.baseUrl}/images/generations`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size,
          quality,
          response_format: "b64_json",
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${err}` };
      }

      const data = (await res.json()) as {
        data: Array<{ b64_json?: string; revised_prompt?: string }>;
      };

      const item = data.data?.[0];
      if (!item?.b64_json) {
        return { success: false, error: "No image returned" };
      }

      return {
        success: true,
        dataUrl: `data:image/png;base64,${item.b64_json}`,
        revisedPrompt: item.revised_prompt,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.cfg.apiKey}`,
      "HTTP-Referer": this.cfg.siteUrl,
      "X-Title": this.cfg.siteName,
    };
  }

  /** Test the key with a minimal call — returns true if the key is valid */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const result = await this.ask("Reply with the single word: OK", "openai/gpt-4o-mini");
    if (result.success && result.text?.includes("OK")) {
      return { ok: true };
    }
    return { ok: false, error: result.error ?? "Unexpected response" };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton factory (lazy — only created when a key is available)
// ──────────────────────────────────────────────────────────────────────────────

const API_KEY_STORAGE = "videoforge_openrouter_key";

export function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function saveApiKey(key: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE, key.trim());
  } catch {
    /* SSR / sandboxed context */
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    /* noop */
  }
}

/** Returns a client using the stored key, or null if no key is saved. */
export function getOpenRouterClient(): OpenRouterClient | null {
  const key = getStoredApiKey();
  if (!key) return null;
  return new OpenRouterClient({ apiKey: key });
}

// ──────────────────────────────────────────────────────────────────────────────
// Prompt helpers for VideoForge pipeline
// ──────────────────────────────────────────────────────────────────────────────

export function buildThumbnailPrompt(
  transcriptText: string,
  projectName: string,
  style = "professional, high contrast, bold text overlay",
): string {
  const snippet = transcriptText.slice(0, 400).replace(/\n/g, " ");
  return (
    `Create a YouTube thumbnail for a video titled "${projectName}". ` +
    `The video is about: "${snippet}". ` +
    `Style: ${style}. ` +
    `Requirements: eye-catching, vibrant colors, clear focal point, no explicit text on the image itself, ` +
    `cinematic lighting, 16:9 aspect ratio composition. ` +
    `Make it look professional and click-worthy.`
  );
}

export function buildHighlightsPrompt(transcriptText: string): string {
  return (
    `You are a video editor assistant. Analyze this transcript and identify the 3 most engaging ` +
    `60-second segments for a short-form reel (TikTok / Reels / Shorts). ` +
    `For each segment provide: start_time (seconds), end_time (seconds), title (max 8 words), reason (1 sentence).\n\n` +
    `Transcript:\n${transcriptText.slice(0, 3000)}\n\n` +
    `Respond ONLY with valid JSON array: ` +
    `[{"start_time":0,"end_time":60,"title":"...","reason":"..."}]`
  );
}
