import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { generateText } from "@/lib/ai";

const GENERATION_TIMEOUT_MS = 30_000;

interface CodeSuggestionRequest {
  fileContent: string;
  cursorLine: number;
  cursorColumn: number;
  suggestionType: string;
  fileName?: string;
}

interface CodeContext {
  language: string;
  framework: string;
  beforeContext: string;
  currentLine: string;
  afterContext: string;
  cursorPosition: { line: number; column: number };
  isInFunction: boolean;
  isInClass: boolean;
  isAfterComment: boolean;
  incompletePatterns: string[];
}

export async function POST(request: NextRequest) {
  try {
    // Only signed-in users may use the AI, so the API key's quota isn't
    // open to anyone who finds the URL
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Please sign in to use the AI" },
        { status: 401 }
      );
    }

    const body: CodeSuggestionRequest = await request.json();

    const { fileContent, cursorLine, cursorColumn, suggestionType, fileName } =
      body;

    // Validate input (an empty file is valid: "" is still a string)
    if (
      typeof fileContent !== "string" ||
      typeof cursorLine !== "number" ||
      typeof cursorColumn !== "number" ||
      cursorLine < 0 ||
      cursorColumn < 0 ||
      !suggestionType
    ) {
      return NextResponse.json(
        { error: "Invalid input parameters" },
        { status: 400 }
      );
    }

    const context = analyzeCodeContext(
      fileContent,
      cursorLine,
      cursorColumn,
      fileName
    );

    const prompt = buildPrompt(context, suggestionType);

    // Pass the browser's cancel signal on, so Ollama stops generating when
    // the editor cancels an outdated request
    const suggestion = await generateSuggestion(prompt, request.signal);

    return NextResponse.json({
      // null (not an error message) when there's nothing to suggest, so the
      // editor never shows or inserts "// AI suggestion unavailable"
      suggestion: suggestion || null,
      metadata: {
        language: context.language,
        framework: context.framework,
        position: context.cursorPosition,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (request.signal.aborted) {
      // The editor cancelled this request; nobody is waiting for the answer
      return new NextResponse(null, { status: 499 });
    }
    console.error("Code completion error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

function analyzeCodeContext(
  content: string,
  line: number,
  column: number,
  fileName?: string
): CodeContext {
  const lines = content.split("\n");
  const currentLine = lines[line] || "";

  // Get surrounding context (10 lines before and after)
  const contextRadius = 10;
  const startLine = Math.max(0, line - contextRadius);
  const endLine = Math.min(lines.length, line + contextRadius);

  const beforeContext = lines.slice(startLine, line).join("\n");
  const afterContext = lines.slice(line + 1, endLine).join("\n");

  // Detect language and framework
  const language = detectLanguage(content, fileName);
  const framework = detectFramework(content);

  // Analyze code patterns
  const isInFunction = detectInFunction(lines, line);
  const isInClass = detectInClass(lines, line);
  const isAfterComment = detectAfterComment(currentLine, column);
  const incompletePatterns = detectIncompletePatterns(currentLine, column);

  return {
    language, 
    framework,
    beforeContext,
    currentLine,
    afterContext,
    cursorPosition: { line, column },
    isInFunction,
    isInClass,
    isAfterComment,
    incompletePatterns,
  };
}

function buildPrompt(context: CodeContext, suggestionType: string): string {
  return `You are an expert code completion assistant. Generate a ${suggestionType} suggestion.

Language: ${context.language}
Framework: ${context.framework}

Context:
${context.beforeContext}
${context.currentLine.substring(
  0,
  context.cursorPosition.column
)}|CURSOR|${context.currentLine.substring(context.cursorPosition.column)}
${context.afterContext}

Analysis:
- In Function: ${context.isInFunction}
- In Class: ${context.isInClass}
- After Comment: ${context.isAfterComment}
- Incomplete Patterns: ${context.incompletePatterns.join(", ") || "None"}

Instructions:
1. Reply with ONLY the code to insert at |CURSOR|. No explanations, no markdown.
2. Do not repeat code that is already before or after the cursor.
3. Maintain proper indentation and style
4. Follow ${context.language} best practices
5. Keep it short: complete the current statement or block.

Generate suggestion:`;
}

async function generateSuggestion(
  prompt: string,
  clientSignal: AbortSignal
): Promise<string | null> {
  try {
    // Uses Gemini when GEMINI_API_KEY is set, otherwise the local Ollama server.
    // The signal stops generation when the editor cancels an outdated request.
    const raw = await generateText({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2, // low = focused, predictable completions
      maxTokens: 128,
      stop: ["\n\n\n", "|CURSOR|"],
      signal: clientSignal,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
    return cleanSuggestion(raw);
  } catch (error) {
    if (clientSignal.aborted) throw error; // handled in POST
    console.error("AI generation error:", error);
    return null;
  }
}

/** Removes markdown fences and prompt artifacts the model sometimes adds. */
function cleanSuggestion(raw: string): string | null {
  let suggestion = raw;

  if (suggestion.includes("```")) {
    const codeMatch = suggestion.match(/```[\w-]*\n?([\s\S]*?)```/);
    suggestion = codeMatch ? codeMatch[1] : suggestion.replace(/```[\w-]*/g, "");
  }

  suggestion = suggestion.replace(/\|CURSOR\|/g, "").replace(/\s+$/, "");
  return suggestion.trim() ? suggestion : null;
}

// Helper functions for code analysis
function detectLanguage(content: string, fileName?: string): string {
  if (fileName) {
    const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : undefined;
    const extMap: Record<string, string> = {
      ts: "TypeScript",
      tsx: "TypeScript",
      js: "JavaScript",
      jsx: "JavaScript",
      py: "Python",
      java: "Java",
      go: "Go",
      rs: "Rust",
      php: "PHP",
      mjs: "JavaScript",
      cjs: "JavaScript",
      html: "HTML",
      css: "CSS",
      json: "JSON",
      md: "Markdown",
    };
    if (ext && extMap[ext]) return extMap[ext];
  }

  // Content-based detection
  if (content.includes("interface ") || content.includes(": string"))
    return "TypeScript";
  // Was `content.includes("import ")`, which labeled every JS/TS file with
  // an import statement as Python
  if (/^\s*def \w+\(/m.test(content) || /^\s*from \S+ import /m.test(content))
    return "Python";
  if (content.includes("func ") || content.includes("package ")) return "Go";

  return "JavaScript";
}

function detectFramework(content: string): string {
  if (content.includes("import React") || content.includes("useState"))
    return "React";
  if (content.includes("import Vue") || content.includes("<template>"))
    return "Vue";
  if (content.includes("@angular/") || content.includes("@Component"))
    return "Angular";
  if (content.includes("next/") || content.includes("getServerSideProps"))
    return "Next.js";

  return "None";
}

function detectInFunction(lines: string[], currentLine: number): boolean {
  for (let i = currentLine - 1; i >= 0; i--) {
    const line = lines[i];
    if (line?.match(/^\s*(function|def|const\s+\w+\s*=|let\s+\w+\s*=)/))
      return true;
    if (line?.match(/^\s*}/)) break;
  }
  return false;
}

function detectInClass(lines: string[], currentLine: number): boolean {
  for (let i = currentLine - 1; i >= 0; i--) {
    const line = lines[i];
    if (line?.match(/^\s*(class|interface)\s+/)) return true;
  }
  return false;
}

function detectAfterComment(line: string, column: number): boolean {
  const beforeCursor = line.substring(0, column);
  return /\/\/.*$/.test(beforeCursor) || /#.*$/.test(beforeCursor);
}

function detectIncompletePatterns(line: string, column: number): string[] {
  const beforeCursor = line.substring(0, column);
  const patterns: string[] = [];

  if (/^\s*(if|while|for)\s*\($/.test(beforeCursor.trim()))
    patterns.push("conditional");
  if (/^\s*(function|def)\s*$/.test(beforeCursor.trim()))
    patterns.push("function");
  if (/\{\s*$/.test(beforeCursor)) patterns.push("object");
  if (/\[\s*$/.test(beforeCursor)) patterns.push("array");
  if (/=\s*$/.test(beforeCursor)) patterns.push("assignment");
  if (/\.\s*$/.test(beforeCursor)) patterns.push("method-call");

  return patterns;
}