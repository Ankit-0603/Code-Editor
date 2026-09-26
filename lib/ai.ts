/**
 * One place for AI text generation.
 *
 * Uses Google Gemini when GEMINI_API_KEY is set (works on Vercel, free tier),
 * otherwise falls back to a local Ollama server (works on your machine).
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "codellama:latest";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  /** Cancels the request when the browser goes away */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const usingGemini = () => Boolean(GEMINI_API_KEY);

/** Name of the model actually in use, so the UI can show it instead of guessing */
export const activeModelName = () => (GEMINI_API_KEY ? GEMINI_MODEL : OLLAMA_MODEL);

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

export async function generateText({
  system,
  messages,
  temperature = 0.4,
  maxTokens = 1024,
  stop,
  signal,
  timeoutMs = 45_000,
}: GenerateOptions): Promise<string> {
  const { signal: requestSignal, cleanup } = withTimeout(signal, timeoutMs);

  try {
    if (GEMINI_API_KEY) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
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
            },
          }),
          signal: requestSignal,
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

    // Local Ollama
    const prompt = [
      ...(system ? [`system: ${system}`] : []),
      ...messages.map((m) => `${m.role}: ${m.content}`),
    ].join("\n\n");

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        // Ollama's option names: `num_predict`, not `max_tokens`
        options: {
          temperature,
          num_predict: maxTokens,
          ...(stop ? { stop } : {}),
        },
      }),
      signal: requestSignal,
    });

    if (!response.ok) {
      throw new Error(`Ollama error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return typeof data.response === "string" ? data.response : "";
  } finally {
    cleanup();
  }
}