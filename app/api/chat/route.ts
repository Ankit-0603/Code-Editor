import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { activeModelName, generateText, type ChatMessage } from "@/lib/ai";

interface ChatRequest {
  message: string;
  history: ChatMessage[]; // the model has no memory, so history is sent each time
}

const SYSTEM_PROMPT = `You are a helpful AI coding assistant. You help developers with:
- Code explanations and debugging
- Best practices and architecture advice
- Writing clean, efficient code
- Troubleshooting errors
- Code reviews and optimizations

Always provide clear, practical answers. Use proper code formatting when showing examples.`;

export async function POST(req: NextRequest) {
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

    const body: ChatRequest = await req.json();
    const { message, history = [] } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required and must be a string" },
        { status: 400 }
      );
    }

    const validHistory = Array.isArray(history)
      ? history.filter(
          (msg) =>
            msg &&
            typeof msg === "object" &&
            typeof msg.content === "string" &&
            (msg.role === "user" || msg.role === "assistant")
        )
      : [];

    const messages: ChatMessage[] = [
      ...validHistory.slice(-10),
      { role: "user", content: message },
    ];

    const aiResponse = await generateText({
      system: SYSTEM_PROMPT,
      messages,
      temperature: 0.7,
      maxTokens: 1024,
      signal: req.signal, // stop generating if the user closes the chat
    });

    if (!aiResponse.trim()) {
      throw new Error("No response from AI model");
    }

    return NextResponse.json({
      response: aiResponse.trim(),
      // Which model answered, so the panel can display it
      model: activeModelName(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (req.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    console.error("Chat API Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        error: "Failed to generate AI response",
        details: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}