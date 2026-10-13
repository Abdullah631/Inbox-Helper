import { NextResponse } from "next/server";
import { getProvider } from "@/lib/llm";
import { ACTIVE_PROMPTS } from "@/lib/prompts";

// Tells the UI whether AI mode is available. Never returns the key itself.
export function GET() {
  const provider = getProvider();
  return NextResponse.json({
    llmAvailable: Boolean(provider),
    provider: provider?.name ?? null,
    model: provider?.model ?? null,
    promptVersion: process.env.CLASSIFY_PROMPT_VERSION || ACTIVE_PROMPTS.classify,
  });
}
