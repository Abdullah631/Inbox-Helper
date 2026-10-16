import { NextResponse } from "next/server";
import { getProviders } from "@/lib/llm";

// Tells the UI whether AI mode is available. Model names aren't returned any more:
// they help someone tailor an attack and the UI doesn't need them up front (Day 5
// security review). Each sort and draft response says which model answered.
export function GET() {
  return NextResponse.json({ llmAvailable: getProviders().length > 0 }, { headers: { "cache-control": "no-store" } });
}
