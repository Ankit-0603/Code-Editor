import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { defaultModelId, listModels } from "@/lib/ai";

// Always run on request: the available models depend on what's running now
export const dynamic = "force-dynamic";

/** Lists the AI models this server can use, for the chat panel's picker */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Please sign in to use the AI" }, { status: 401 });
  }

  const [models, defaultModel] = await Promise.all([listModels(), defaultModelId()]);
  return NextResponse.json({ models, defaultModel });
}