import { NextResponse } from "next/server";
import { classifyInbox, NoProviderError } from "@/lib/classify";
import { ClassifyRequestSchema } from "@/lib/schema";

// LLM batches can take a while on the free tier, especially after a 429.
export const maxDuration = 60;

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

  try {
    return NextResponse.json(await classifyInbox(parsed.data.messages, parsed.data.mode));
  } catch (e) {
    if (e instanceof NoProviderError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Classification failed. Try keyword mode." }, { status: 500 });
  }
}
