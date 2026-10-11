import { type NextRequest, NextResponse } from "next/server";
import { CompletionCopilot, type CompletionMetadata } from "monacopilot";

import { auth } from "@/auth";
import { generateText, ModelNotAvailableError } from "@/lib/ai";

/**
 * Inline code completion for the editor, in Monacopilot's format.
 *
 * The editor (registerCompletion in playground-editor.tsx) sends
 *   { completionMetadata: { language, filename, technologies, relatedFiles,
 *                           textBeforeCursor, textAfterCursor, cursorPosition } }
 * and expects back
 *   { completion: string | null, error?: string }
 *
 * Monacopilot builds the prompt from that metadata (with our customPrompt
 * below) and calls our `model` function, which goes through lib/ai.ts, so it
 * works with Gemini on Vercel and Ollama locally.
 */

const GENERATION_TIMEOUT_MS = 20_000;
/** Optional: a model id from /api/models just for completions, e.g. a small fast one */
const COMPLETION_MODEL = process.env.COMPLETION_MODEL || undefined;

const CURSOR = "<|cursor|>";

// Size caps, so one request can't send an enormous prompt
const MAX_CODE_CHARS = 20_000;
const MAX_RELATED_FILES = 3;
const MAX_RELATED_CHARS = 6_000;

export async function POST(request: NextRequest) {
  // Only signed-in users may use the AI, so the API key's quota isn't
  // open to anyone who finds the URL
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { completion: null, error: "Please sign in to use the AI" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const metadata = sanitizeMetadata(body?.completionMetadata);
  if (!metadata) {
    return NextResponse.json(
      { completion: null, error: "Invalid completion request" },
      { status: 400 }
    );
  }

  const copilot = new CompletionCopilot(undefined, {
    // Monacopilot hands us the finished prompt; we send it to our own models
    model: async (prompt) => {
      const raw = await generateText({
        system: prompt.instruction,
        messages: [{ role: "user", content: `${prompt.context}\n\n${prompt.fileContent}` }],
        model: COMPLETION_MODEL,
        temperature: 0.15, // low = focused, predictable completions
        maxTokens: 400, // room for a few lines (and a little thinking on Gemini 3)
        thinking: "low", // completions must be fast; deep reasoning isn't needed
        signal: request.signal, // stop when the editor cancels an outdated request
        timeoutMs: GENERATION_TIMEOUT_MS,
      });
      return { text: cleanCompletion(raw, metadata) };
    },
  });

  try {
    const { completion, error } = await copilot.complete({
      body: { completionMetadata: metadata },
      options: { customPrompt: buildPrompt },
    });
    return NextResponse.json({ completion: completion || null, error });
  } catch (error) {
    if (request.signal.aborted) {
      // The editor cancelled this request; nobody is waiting for the answer
      return new NextResponse(null, { status: 499 });
    }
    if (error instanceof ModelNotAvailableError) {
      return NextResponse.json(
        { completion: null, error: `COMPLETION_MODEL is not available: ${error.message}` },
        { status: 400 }
      );
    }
    console.error("Code completion error:", error);
    return NextResponse.json(
      {
        completion: null,
        error: error instanceof Error ? error.message : "Completion failed",
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** The system prompt: what the model is, and the rules for a good completion */
const INSTRUCTION = `You are the inline code-completion engine of a browser code editor, like GitHub Copilot.
You are shown one file with the marker ${CURSOR} at the developer's cursor. Write the code that should be inserted at exactly that point.

Rules:
- Output only the raw code to insert. No explanations, no markdown, no code fences.
- Never repeat code that is already before the cursor, and never include code that already comes after it.
- Continue exactly from the cursor: if it is in the middle of a word or a line, finish that word or line.
- Match the file's existing indentation, quotes, semicolons and naming style.
- Keep it short: complete the current statement, or the current block when it is clearly unfinished. Prefer fewer than 10 lines.
- Only use variables, functions and imports that exist in the file, the related files, or the listed libraries. Do not invent APIs.
- If the line just before the cursor is a comment describing code, write that code.
- If nothing useful can be added, output nothing.`;

function buildPrompt(metadata: CompletionMetadata) {
  const { language, filename, technologies, relatedFiles, textBeforeCursor, textAfterCursor } =
    metadata;

  const context = [
    `Language: ${language || "unknown"}`,
    `File: ${filename || "unknown"}`,
    technologies?.length ? `Libraries: ${technologies.join(", ")}` : "",
    `Cursor: ${describeCursor(textBeforeCursor, textAfterCursor)}`,
    relatedFiles?.length
      ? "Related files (for reference only, do not complete them):\n" +
        relatedFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const fileContent = `<file path="${filename || "untitled"}">\n${textBeforeCursor}${CURSOR}${textAfterCursor}\n</file>`;

  return { instruction: INSTRUCTION, context, fileContent };
}

/** A short hint about where the cursor is, which helps small models a lot */
function describeCursor(before: string, after: string): string {
  const lineBefore = before.slice(before.lastIndexOf("\n") + 1);
  const lineAfter = after.split("\n", 1)[0];
  const prevLine = before.split("\n").slice(-2, -1)[0]?.trim() ?? "";

  if (/^\s*(\/\/|#|\/\*|\*)/.test(lineBefore)) return "inside a comment";
  if (lineBefore.trim() && lineAfter.trim()) return "in the middle of a line";
  if (lineBefore.trim()) return "at the end of a line that is still being written";
  if (/^(\/\/|#|\/\*|\*)/.test(prevLine)) return "on a new line right after a comment";
  return "at the start of an empty line";
}

// ---------------------------------------------------------------------------
// Input and output clean-up
// ---------------------------------------------------------------------------

function str(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

/** Validates the request and caps its size */
function sanitizeMetadata(input: unknown): CompletionMetadata | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;

  const before = str(m.textBeforeCursor, Infinity);
  const after = str(m.textAfterCursor, Infinity);
  const pos = m.cursorPosition as { lineNumber?: unknown; column?: unknown } | undefined;
  if (
    before === null ||
    after === null ||
    typeof pos?.lineNumber !== "number" ||
    typeof pos?.column !== "number"
  ) {
    return null;
  }

  const technologies = Array.isArray(m.technologies)
    ? m.technologies.filter((t): t is string => typeof t === "string").slice(0, 8).map((t) => t.slice(0, 40))
    : undefined;

  const relatedFiles = Array.isArray(m.relatedFiles)
    ? m.relatedFiles
        .filter(
          (f): f is { path: string; content: string } =>
            !!f && typeof f.path === "string" && typeof f.content === "string"
        )
        .slice(0, MAX_RELATED_FILES)
        .map((f) => ({ path: f.path.slice(0, 200), content: f.content.slice(0, MAX_RELATED_CHARS) }))
    : undefined;

  return {
    language: str(m.language, 40) ?? undefined,
    filename: str(m.filename, 200) ?? undefined,
    technologies,
    relatedFiles,
    // Keep the code closest to the cursor
    textBeforeCursor: before.slice(-MAX_CODE_CHARS),
    textAfterCursor: after.slice(0, MAX_CODE_CHARS / 2),
    cursorPosition: { lineNumber: pos.lineNumber, column: pos.column },
  };
}

/**
 * Small models often break the rules anyway: wrapping code in ``` fences,
 * echoing the cursor marker, or repeating text around the cursor. This
 * removes those, so what's inserted is just the new code.
 */
function cleanCompletion(raw: string, metadata: CompletionMetadata): string | null {
  let text = raw.replace(/\r/g, "");

  // ```lang ... ``` → just the code
  if (text.includes("```")) {
    const fenced = text.match(/```[\w-]*\n?([\s\S]*?)```/);
    text = fenced ? fenced[1] : text.replace(/```[\w-]*\n?/g, "");
  }

  text = text.split(CURSOR).join("");

  // The model repeated what's already typed on this line: drop the repeat
  const lineBefore = metadata.textBeforeCursor.slice(metadata.textBeforeCursor.lastIndexOf("\n") + 1);
  const typed = lineBefore.trim();
  if (typed.length >= 3 && text.trimStart().startsWith(typed)) {
    text = text.trimStart().slice(typed.length);
  }

  text = text.replace(/\s+$/, "");

  // The model also wrote what already follows the cursor (e.g. a closing "});").
  // Compare with the first non-empty line after the cursor.
  const lineAfter =
    metadata.textAfterCursor.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (lineAfter.length >= 2 && text.endsWith(lineAfter)) {
    text = text.slice(0, -lineAfter.length).replace(/\s+$/, "");
  }

  return text.trim() ? text : null;
}