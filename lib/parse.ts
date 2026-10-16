import { CLIENT_LIMITS } from "./limits";
import { MessageSchema, type Message } from "./schema";

export type InputFormat = "json" | "csv" | "text" | "empty";
export type ParseResult = { messages: Message[]; errors: string[]; format: InputFormat };

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// Column names we understand in a CSV header, with common alternatives.
const CSV_COLUMNS: Record<string, keyof Message> = {
  id: "id",
  from: "from", email: "from", sender: "from",
  subject: "subject", title: "subject",
  body: "body", message: "body", text: "body",
};

// Accepts what a recruiter is likely to paste: a JSON array, a CSV with a header
// row, or plain text messages separated by lines of `---`.
export function parseInbox(raw: string, maxMessages: number = CLIENT_LIMITS.inboxMessagesMax): ParseResult {
  const text = raw.replace(/^﻿/, "").trim();
  if (!text) return { messages: [], errors: ["Input is empty."], format: "empty" };

  const format = detectFormat(text);
  let records: unknown[];
  try {
    records = format === "json" ? parseJson(text) : format === "csv" ? parseCsvRecords(text) : splitText(text);
  } catch (e) {
    if (e instanceof ParseError) return { messages: [], errors: [e.message], format };
    throw e;
  }
  return fromRecords(records, format, maxMessages);
}

// JSON only when it really looks like JSON: "[URGENT] can we move..." is plain text
// (Day 5 review: it used to fail as broken JSON). CSV only when the first line is a
// header made of column names we know, so a message starting with "Body" stays text.
export function detectFormat(text: string): Exclude<InputFormat, "empty"> {
  if (text.startsWith("{") || /^\[\s*[{"\]]/.test(text)) return "json";
  if (text.startsWith("[") && parsesAsJson(text)) return "json";
  const header = text.split(/\r?\n/, 1)[0].toLowerCase();
  const columns = header.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const known = columns.every((c) => c in CSV_COLUMNS);
  if (known && columns.some((c) => CSV_COLUMNS[c] === "body")) return "csv";
  return "text";
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function parseJson(text: string): unknown[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ParseError(`Invalid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) throw new ParseError("JSON must be an array of messages, like [{\"body\": \"...\"}].");
  return data;
}

function splitText(text: string): unknown[] {
  // [ \t]* instead of \s*: with \s, a paste of many blank lines made this regex take
  // seconds and froze the page on every keystroke (Day 5 review).
  return text
    .split(/^[ \t]*-{3,}[ \t]*$/m)
    .map((b) => b.trim())
    .filter(Boolean);
}

function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (!rows.length) throw new ParseError("The CSV has a header row but no messages under it.");
  // Map alternative column names onto ours; unknown columns can't appear (see detectFormat).
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [CSV_COLUMNS[k] ?? k, v])));
}

// Minimal RFC 4180 parser: quoted fields, escaped quotes, newlines inside quotes.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new ParseError("CSV has an unclosed quote.");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

function toCandidate(rec: unknown): Record<string, unknown> {
  if (typeof rec === "string") return { body: rec };
  if (rec && typeof rec === "object" && !Array.isArray(rec)) {
    const out: Record<string, unknown> = { ...(rec as Record<string, unknown>) };
    // An empty id cell (common in CSVs) means "make one up", not "invalid".
    if (out.id === "" || out.id === null || out.id === undefined) delete out.id;
    return out;
  }
  return { body: undefined };
}

function fromRecords(records: unknown[], format: InputFormat, maxMessages: number): ParseResult {
  const errors: string[] = [];
  if (records.length > maxMessages) {
    errors.push(`Only the first ${maxMessages} of ${records.length} messages are used. Split the rest into another batch.`);
    records = records.slice(0, maxMessages);
  }

  const candidates = records.map(toCandidate);
  const used = new Set(candidates.map((c) => c.id).filter((id): id is string => typeof id === "string"));
  let next = 1;
  // Made-up ids skip any id the input already uses, so "msg-2" from a user and an
  // automatic "msg-2" can't collide (Day 5 review: that left the results page blank).
  const freshId = () => {
    while (used.has(`msg-${next}`)) next++;
    used.add(`msg-${next}`);
    return `msg-${next}`;
  };

  const messages: Message[] = [];
  const seen = new Set<string>();
  candidates.forEach((candidate, i) => {
    const parsed = MessageSchema.safeParse({ ...candidate, id: candidate.id ?? freshId() });
    if (!parsed.success) {
      const why = parsed.error.issues.map((x) => (x.path.length ? `${x.path.join(".")}: ${x.message}` : x.message)).join("; ");
      errors.push(`Item ${i + 1}: ${why}`);
      return;
    }
    if (seen.has(parsed.data.id)) {
      errors.push(`Item ${i + 1}: id "${parsed.data.id}" is used twice. Kept the first one and skipped this one.`);
      return;
    }
    seen.add(parsed.data.id);
    messages.push(parsed.data);
  });

  return { messages, errors, format };
}
