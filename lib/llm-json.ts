// Shared plumbing for "ask a model for JSON, check it, retry once with the error".
// classify, draft and the reviewer all used to carry their own copy of this.
import { JSON_ATTEMPTS } from "./limits";
import type { CallOptions, ChatMessage, LlmProvider } from "./llm";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export class InvalidOutputError extends Error {
  constructor(lastError: string) {
    super(`Model output invalid twice (${lastError}).`);
    this.name = "InvalidOutputError";
  }
}

export function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export function parseJsonLoose(raw: string): Parsed<unknown> {
  try {
    return { ok: true, value: JSON.parse(stripFences(raw)) };
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
}

// Candidate text goes inside a tag. JSON.stringify doesn't escape "<", so a message
// containing "</messages>" could look like it closes the tag. Escaping "<" keeps the
// text identical once the model reads the JSON string, but removes the fake boundary.
export function dataBlock(tag: string, data: unknown): string {
  return `<${tag}>\n${JSON.stringify(data, null, 2).replace(/</g, "\\u003c")}\n</${tag}>`;
}

export async function completeValidated<T>(
  provider: LlmProvider,
  system: string,
  user: string,
  parse: (raw: string) => Parsed<T>,
  opts: CallOptions = {},
): Promise<T> {
  const chat: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let lastError = "";
  for (let attempt = 0; attempt < JSON_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      chat.push({ role: "user", content: `Your last reply was invalid: ${lastError}. Reply again with valid JSON only.` });
    }
    const parsed = parse(await provider.completeJson(chat, opts));
    if (parsed.ok) return parsed.value;
    lastError = parsed.error;
  }
  throw new InvalidOutputError(lastError);
}

// Checks that a model answered for exactly the ids it was given: none missing, none
// repeated, none invented. On Day 5 the review found duplicates silently overwrote
// each other ("last one wins") and unknown ids were ignored.
export function checkIds(returned: string[], expected: string[]): string | null {
  const want = new Set(expected);
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of returned) (seen.has(id) ? dupes : seen).add(id);
  const missing = expected.filter((id) => !seen.has(id));
  const unknown = [...seen].filter((id) => !want.has(id));
  if (missing.length) return `missing results for ids ${missing.join(", ")}`;
  if (dupes.size) return `more than one result for ids ${[...dupes].join(", ")}`;
  if (unknown.length) return `results for ids that weren't asked about: ${unknown.join(", ")}`;
  return null;
}

// Runs fn over fixed-size batches. A batch that fails is handed to onFail, so one bad
// batch never sinks the others.
export async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (batch: T[], start: number) => Promise<R[]>,
  onFail: (batch: T[], start: number, error: unknown) => R[],
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    try {
      out.push(...(await fn(batch, i)));
    } catch (e) {
      out.push(...onFail(batch, i, e));
    }
  }
  return out;
}

// Error text that is safe to show in the browser: our own messages only, never raw
// model output or provider bodies.
export function safeErrorMessage(e: unknown): string {
  if (e instanceof Error && (e.name === "LlmError" || e.name === "InvalidOutputError")) return e.message;
  return "Unexpected error.";
}
