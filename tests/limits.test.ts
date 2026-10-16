import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BATCH_SIZES, CLIENT_LIMITS, MESSAGE_LIMITS, PROMPT_BODY_CHARS, REQUEST_LIMITS } from "@/lib/limits";

// The limits depend on each other. These checks fail if someone changes one without the
// others, instead of the app quietly breaking in production.
describe("limits stay consistent", () => {
  it("a full request fits in the body size limit", () => {
    // Worst case: every message at its maximum size, as JSON.
    const perMessage = MESSAGE_LIMITS.bodyMax + MESSAGE_LIMITS.subjectMax + MESSAGE_LIMITS.fromMax + MESSAGE_LIMITS.idMax + 100;
    expect(REQUEST_LIMITS.classifyMessagesMax * perMessage).toBeLessThan(REQUEST_LIMITS.bodyBytesMax * 1.2);
  });

  it("server batches divide the request sizes the UI sends", () => {
    expect(REQUEST_LIMITS.classifyMessagesMax % BATCH_SIZES.classify).toBe(0);
    expect(REQUEST_LIMITS.draftItemsMax % BATCH_SIZES.draft).toBe(0);
  });

  it("models see less than a full message, and the inbox cap holds whole chunks", () => {
    expect(PROMPT_BODY_CHARS).toBeLessThan(MESSAGE_LIMITS.bodyMax);
    expect(CLIENT_LIMITS.inboxMessagesMax % REQUEST_LIMITS.classifyMessagesMax).toBe(0);
  });
});

describe("the sample inbox served to the browser", () => {
  it("matches data/sample-inbox.json with the labels removed", () => {
    const labeled = JSON.parse(readFileSync("data/sample-inbox.json", "utf8")) as Record<string, unknown>[];
    const served = JSON.parse(readFileSync("public/sample-inbox.json", "utf8"));
    expect(served).toEqual(labeled.map(({ id, from, subject, body }) => ({ id, from, subject, body })));
    expect(JSON.stringify(served)).not.toMatch(/expected_intent|label_source|note/);
  });
});
