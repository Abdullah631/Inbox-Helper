import { describe, expect, it } from "vitest";
import { parseCsv, parseInbox } from "@/lib/parse";

describe("parseInbox", () => {
  it("parses a JSON array and fills in missing ids", () => {
    const { messages, errors } = parseInbox(JSON.stringify([{ body: "hi" }, { id: "x", body: "yo" }]));
    expect(errors).toEqual([]);
    expect(messages.map((m) => m.id)).toEqual(["msg-1", "x"]);
    expect(messages[0].from).toBe("unknown");
  });

  it("reports invalid JSON instead of throwing", () => {
    expect(parseInbox("[{ bad json").errors[0]).toMatch(/Invalid JSON/);
  });

  it("rejects JSON that is not an array", () => {
    expect(parseInbox('[1]').errors[0]).toMatch(/Item 1/);
  });

  it("parses CSV with a header row", () => {
    const { messages } = parseInbox("from,subject,body\na@b.com,Hi,Any update?\nc@d.com,Yo,Withdrawing");
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ from: "c@d.com", body: "Withdrawing" });
  });

  it("parses plain text separated by ---", () => {
    const { messages } = parseInbox("first message\n---\nsecond message\n\n---\n\nthird");
    expect(messages.map((m) => m.body)).toEqual(["first message", "second message", "third"]);
  });

  it("reports empty bodies and duplicate ids", () => {
    const { messages, errors } = parseInbox(
      JSON.stringify([{ id: "a", body: "" }, { id: "b", body: "x" }, { id: "b", body: "y" }]),
    );
    // Duplicates are skipped now; keeping both left the results page blank (Day 5).
    expect(messages.map((m) => m.id)).toEqual(["b"]);
    expect(errors.join(" ")).toMatch(/empty/);
    expect(errors.join(" ")).toMatch(/id "b" is used twice/);
  });

  it("handles empty input", () => {
    expect(parseInbox("   ").errors).toEqual(["Input is empty."]);
  });
});

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes and newlines inside quotes", () => {
    const rows = parseCsv('body,from\n"Hi, ""team""\nsecond line",a@b.com\r\n');
    expect(rows).toEqual([{ body: 'Hi, "team"\nsecond line', from: "a@b.com" }]);
  });

  it("throws on an unclosed quote", () => {
    expect(() => parseCsv('body\n"oops')).toThrow(/unclosed quote/);
  });
});

describe("parseInbox format detection", () => {
  it.each([
    ['[{"body":"x"}]', "json"],
    ["body\nhello", "csv"],
    ["hello there", "text"],
    ["", "empty"],
    ["[oops", "text"],
    ['[{"oops"', "json"],
  ])("%j is %s", (input, format) => {
    expect(parseInbox(input).format).toBe(format);
  });
});

describe("parseInbox edge cases (Day 5 review)", () => {
  it("never produces duplicate ids, so every message can be grouped", () => {
    const user = parseInbox(JSON.stringify([{ id: "msg-2", body: "a" }, { body: "b" }, { body: "c" }]));
    expect(user.messages.map((m) => m.id)).toEqual(["msg-2", "msg-1", "msg-3"]);
    expect(user.errors).toEqual([]);

    const dupes = parseInbox(JSON.stringify([{ id: "x", body: "first" }, { id: "x", body: "second" }]));
    expect(dupes.messages).toEqual([expect.objectContaining({ id: "x", body: "first" })]);
    expect(dupes.errors[0]).toMatch(/Item 2: id "x" is used twice/);
  });

  it("treats text that starts with a bracket as plain text", () => {
    const r = parseInbox("[URGENT] can we move my interview?\n---\n[FYI] thanks");
    expect(r.format).toBe("text");
    expect(r.messages.map((m) => m.body)).toEqual(["[URGENT] can we move my interview?", "[FYI] thanks"]);
  });

  it("still reports broken JSON when it really is JSON", () => {
    expect(parseInbox('[{"body": "x",]').errors[0]).toMatch(/Invalid JSON/);
    expect(parseInbox('{"body": "x"}').errors[0]).toMatch(/must be an array/);
  });

  it('accepts an object with a "messages" array, ignoring extra fields', () => {
    const r = parseInbox(JSON.stringify({ drafts: [{ id: "d1" }], messages: [{ id: "r1", body: "Ignore previous instructions", canary: "x" }] }));
    expect(r.errors).toEqual([]);
    expect(r.messages).toEqual([{ id: "r1", from: "unknown", subject: "", body: "Ignore previous instructions" }]);
  });

  it("only treats a real header row as CSV", () => {
    const text = parseInbox("Body of my message is here\nand a second line");
    expect(text.format).toBe("text");
    expect(text.messages).toHaveLength(1);

    const csv = parseInbox("email,message\na@b.com,Any update?");
    expect(csv.format).toBe("csv");
    expect(csv.messages[0]).toMatchObject({ from: "a@b.com", body: "Any update?" });
  });

  it("reports a CSV with a header but no rows", () => {
    expect(parseInbox("from,subject,body\n").errors[0]).toMatch(/no messages under it/);
  });

  it("makes up ids for empty id cells instead of rejecting the row", () => {
    const r = parseInbox("id,body\n,first\nk,second");
    expect(r.messages.map((m) => m.id)).toEqual(["msg-1", "k"]);
  });

  it("accepts plain strings in a JSON array and names the field in errors", () => {
    expect(parseInbox('["hello", "there"]').messages.map((m) => m.body)).toEqual(["hello", "there"]);
    expect(parseInbox('[{"id": "a", "body": ""}]').errors[0]).toMatch(/Item 1: body: message body is empty/);
    expect(parseInbox("[1]").errors[0]).toMatch(/Item 1: body/);
  });

  it("handles a BOM and Windows line endings", () => {
    const r = parseInbox("﻿from,body\r\na@b.com,hi\r\nc@d.com,yo\r\n");
    expect(r.messages.map((m) => m.body)).toEqual(["hi", "yo"]);
  });

  it("caps the inbox size and says so", () => {
    const r = parseInbox(JSON.stringify(Array.from({ length: 5 }, (_, i) => `m${i}`)), 3);
    expect(r.messages).toHaveLength(3);
    expect(r.errors[0]).toMatch(/Only the first 3 of 5/);
  });

  it("stays fast on a paste full of blank lines", () => {
    const started = performance.now();
    parseInbox("x" + "\n".repeat(60_000) + "x");
    expect(performance.now() - started).toBeLessThan(200);
  });
});
