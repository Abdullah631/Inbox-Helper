import { MessageSchema, type Message } from "./schema";

export type InputFormat = "json" | "csv" | "text" | "empty";
export type ParseResult = { messages: Message[]; errors: string[]; format: InputFormat };

// Accepts what a recruiter is likely to paste: a JSON array, a CSV with a
// header row, or plain text messages separated by lines of `---`.
export function parseInbox(raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { messages: [], errors: ["Input is empty."], format: "empty" };

  try {
    if (text.startsWith("[")) return fromRecords(parseJson(text), "json");

    const firstLine = text.split(/\r?\n/, 1)[0].toLowerCase();
    if (/(^|,)\s*"?body"?\s*(,|$)/.test(firstLine)) return fromRecords(parseCsv(text), "csv");
  } catch (e) {
    if (e instanceof ParseError) return { messages: [], errors: [e.message], format: text.startsWith("[") ? "json" : "csv" };
    throw e;
  }

  return fromRecords(
    text
      .split(/^\s*-{3,}\s*$/m)
      .map((b) => b.trim())
      .filter(Boolean)
      .map((body) => ({ body })),
    "text",
  );
}

function parseJson(text: string): unknown[] {
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new ParseError("JSON must be an array of messages.");
    return data;
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError(`Invalid JSON: ${(e as Error).message}`);
  }
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
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

function fromRecords(records: unknown[], format: InputFormat): ParseResult {
  const messages: Message[] = [];
  const errors: string[] = [];

  records.forEach((rec, i) => {
    const candidate = { id: `msg-${i + 1}`, ...(rec as object) };
    const parsed = MessageSchema.safeParse(candidate);
    if (parsed.success) messages.push(parsed.data);
    else errors.push(`Item ${i + 1}: ${parsed.error.issues.map((x) => x.message).join("; ")}`);
  });

  const seen = new Set<string>();
  for (const m of messages) {
    if (seen.has(m.id)) errors.push(`Duplicate id "${m.id}".`);
    seen.add(m.id);
  }

  return { messages, errors, format };
}

export class ParseError extends Error {}
