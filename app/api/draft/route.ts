import { handleJsonPost } from "@/lib/api";
import { draftReplies } from "@/lib/draft";
import { getProviders } from "@/lib/llm";
import { DraftRequestSchema } from "@/lib/schema";

export const maxDuration = 60;

export function POST(req: Request) {
  return handleJsonPost(req, {
    schema: DraftRequestSchema,
    cost: ({ items, mode }) => ({
      kind: mode === "keyword" || getProviders().length === 0 ? "keyword" : "ai",
      units: items.length,
    }),
    run: ({ items, mode }, signal) => draftReplies(items, mode, { signal }),
  });
}
