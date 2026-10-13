import { NextResponse } from "next/server";
import { classifyFallback } from "@/lib/fallback";
import { ClassifyRequestSchema } from "@/lib/schema";

// Day 1: keyword fallback only. Day 2 adds the LLM path behind the same contract,
// and this stays as the fallback when no key is set or the LLM call fails.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = ClassifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  const classifications = parsed.data.messages.map(classifyFallback);
  return NextResponse.json({ classifications, method: "fallback" });
}
