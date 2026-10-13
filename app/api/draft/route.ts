import { NextResponse } from "next/server";
import { draftReplies } from "@/lib/draft";
import { DraftRequestSchema } from "@/lib/schema";

export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = DraftRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await draftReplies(parsed.data.items, parsed.data.mode));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Drafting failed. Try keyword mode for template replies." }, { status: 500 });
  }
}
