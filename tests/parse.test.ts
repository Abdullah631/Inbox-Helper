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
    expect(messages).toHaveLength(2);
    expect(errors.join(" ")).toMatch(/empty/);
    expect(errors.join(" ")).toMatch(/Duplicate id "b"/);
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
    ["[oops", "json"],
  ])("%j is %s", (input, format) => {
    expect(parseInbox(input).format).toBe(format);
  });
});
