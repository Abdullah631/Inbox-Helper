import { handleJsonPost } from "@/lib/api";
import { classifyInbox } from "@/lib/classify";
import { getProviders } from "@/lib/llm";
import { ClassifyRequestSchema } from "@/lib/schema";

// Next.js needs this as a literal. The model calls inside stop earlier, at
// REQUEST_BUDGET_MS, so the route always answers before this limit.
export const maxDuration = 60;

export function POST(req: Request) {
  return handleJsonPost(req, {
    schema: ClassifyRequestSchema,
    cost: ({ messages, mode }) => ({
      kind: mode === "keyword" || getProviders().length === 0 ? "keyword" : "ai",
      units: messages.length,
    }),
    run: ({ messages, mode }, signal) => classifyInbox(messages, mode, { signal }),
  });
}
