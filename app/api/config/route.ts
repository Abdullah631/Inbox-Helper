import { NextResponse } from "next/server";
import { getProviders } from "@/lib/llm";
import { ACTIVE_PROMPTS } from "@/lib/prompts";

// Tells the UI whether AI mode is available. Never returns the key itself.
export function GET() {
  const [primary, backup] = getProviders();
  return NextResponse.json({
    llmAvailable: Boolean(primary),
    provider: primary?.name ?? null,
    model: primary?.model ?? null,
    backupModel: backup?.model ?? null,
    promptVersion: process.env.CLASSIFY_PROMPT_VERSION || ACTIVE_PROMPTS.classify,
  });
}
