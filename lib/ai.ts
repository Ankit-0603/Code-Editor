/**
 * One place for AI text generation, across providers and models.
 *
 * Model ids are "provider:name", e.g. "gemini:gemini-3.8-flash" or
 * "ollama:gpt-oss:20b". Everything after the first ":" is the provider's own
 * model name (Ollama names contain ":" themselves).
 *
 * - Gemini: available when GEMINI_API_KEY is set. Works on Vercel.
 * - Ollama: whatever models are installed on the Ollama server, discovered
 *   from its /api/tags endpoint. Works locally; on Vercel it is skipped,
 *   because Vercel cannot reach your computer.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
/** Optional extra Gemini models, comma-separated, e.g. "gemini-3.8-pro" */
const GEMINI_EXTRA_MODELS = (process.env.GEMINI_MODELS || "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "codellama:latest";

export type Provider = "gemini" | "ollama";

export interface ModelInfo {
  /** "provider:name", what the client sends back */
  id: string;
  provider: Provider;
  /** The provider's own model name */
  name: string;
  /** Short text for the dropdown */
  label: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  system?: string;
  messages: ChatMessage[];
  /** A ModelInfo id. Omit to use the default model. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  /**
   * How much a "thinking" model reasons before answering. Gemini 3 models
   * default to "medium", which is too slow for inline completions.
   * Ignored by models that don't support it.
   */
  thinking?: "low" | "medium" | "high";
  /** Cancels the request when the browser goes away */
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Thrown for a model id that isn't in the available list */
export class ModelNotAvailableError extends Error {
  constructor(model: string) {
    super(`Model "${model}" is not available`);
    this.name = "ModelNotAvailableError";
  }
}

export const usingGemini = () => Boolean(GEMINI_API_KEY);

function parseModelId(id: string): { provider: Provider; name: string } | null {
  const i = id.indexOf(":");
  if (i === -1) return null;
  const provider = id.slice(0, i);
  const name = id.slice(i + 1);
  if ((provider !== "gemini" && provider !== "ollama") || !name) return null;
  return { provider, name };
}

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

let cache: { models: ModelInfo[]; at: number } | null = null;
const CACHE_MS = 60_000;

async function listOllamaModels(): Promise<ModelInfo[]> {
  try {
    // Short timeout: if Ollama isn't running (or we're on Vercel), give up fast
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = await response.json();
    const models: { name?: string }[] = Array.isArray(data?.models) ? data.models : [];
    return models
      .map((m) => m.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .map((name) => ({
        id: `ollama:${name}`,
        provider: "ollama" as const,
        name,
        label: `${name} (local)`,
      }));
  } catch {
    return [];
  }
}

function listGeminiModels(): ModelInfo[] {
  if (!GEMINI_API_KEY) return [];
  const names = Array.from(new Set([GEMINI_MODEL, ...GEMINI_EXTRA_MODELS]));
  return names.map((name) => ({
    id: `gemini:${name}`,
    provider: "gemini" as const,
    name,
    label: name,
  }));
}

/** Every model this server can use right now. Cached for a minute. */
export async function listModels(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;
  const models = [...listGeminiModels(), ...(await listOllamaModels())];
  cache = { models, at: Date.now() };
  return models;
}

/** The model used when the client doesn't pick one */
export async function defaultModelId(): Promise<string | null> {
  const models = await listModels();
  if (GEMINI_API_KEY) return `gemini:${GEMINI_MODEL}`;
  const preferred = models.find((m) => m.provider === "ollama" && m.name === OLLAMA_MODEL);
  return preferred?.id ?? models[0]?.id ?? null;
}

/** Name of the default model, for code completion and display */
export const activeModelName = () => (GEMINI_API_KEY ? GEMINI_MODEL : OLLAMA_MODEL);

/**
 * Turns a requested id into a model we're allowed to call.
 * Only ids from listModels() are accepted, so a client can't make the server
 * call arbitrary model names.
 */
async function resolveModel(requested?: string): Promise<ModelInfo> {
  const models = await listModels();

  if (requested) {
    const found = models.find((m) => m.id === requested);
    if (!found) throw new ModelNotAvailableError(requested);
    return found;
  }

  const fallbackId = await defaultModelId();
  const fallback = models.find((m) => m.id === fallbackId);
  if (fallback) return fallback;

  // Nothing discovered (e.g. Ollama not running): try the configured default anyway,
  // so the error message comes from the provider instead of a vague "no models"
  const parsed = parseModelId(GEMINI_API_KEY ? `gemini:${GEMINI_MODEL}` : `ollama:${OLLAMA_MODEL}`)!;
  return { id: `${parsed.provider}:${parsed.name}`, ...parsed, label: parsed.name };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Combines the caller's signal with a timeout, so a hung model can't block a serverless function */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort);
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

async function generateWithGemini(
  model: string,
  { system, messages, temperature, maxTokens, stop, thinking }: GenerateOptions,
  signal: AbortSignal
): Promise<string> {
  // Only Gemini 3 models accept thinkingLevel; older ones would reject the request
  const thinkingConfig =
    thinking && /^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: thinking } } : {};

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: messages.map((m) => ({
          // Gemini calls the assistant "model"
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          ...(stop ? { stopSequences: stop } : {}),
          ...thinkingConfig,
        },
      }),
      signal,
    }
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Gemini error ${response.status}: ${details.slice(0, 200)}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)
    ? parts.map((p: { text?: string }) => p.text ?? "").join("")
    : "";
}

async function generateWithOllama(
  model: string,
  { system, messages, temperature, maxTokens, stop }: GenerateOptions,
  signal: AbortSignal
): Promise<string> {
  // /api/chat takes real message roles, which chat models (gpt-oss, llama, qwen...)
  // handle much better than one concatenated prompt
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...messages,
      ],
      stream: false,
      // Ollama's option names: `num_predict`, not `max_tokens`
      options: {
        temperature,
        num_predict: maxTokens,
        ...(stop ? { stop } : {}),
      },
    }),
    signal,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Ollama error ${response.status}: ${details.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.message?.content;
  return typeof content === "string" ? content : "";
}

export interface GenerateResult {
  text: string;
  /** The ModelInfo id that actually answered */
  model: string;
}

/** Like generateText, but also reports which model answered */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const {
    temperature = 0.4,
    maxTokens = 1024,
    timeoutMs = 45_000,
    signal,
  } = options;
  const model = await resolveModel(options.model);
  const { signal: requestSignal, cleanup } = withTimeout(signal, timeoutMs);
  const opts = { ...options, temperature, maxTokens };

  try {
    const text =
      model.provider === "gemini"
        ? await generateWithGemini(model.name, opts, requestSignal)
        : await generateWithOllama(model.name, opts, requestSignal);
    return { text, model: model.id };
  } finally {
    cleanup();
  }
}

/** Text only. Kept so existing callers (code completion) work unchanged. */
export async function generateText(options: GenerateOptions): Promise<string> {
  return (await generate(options)).text;
}