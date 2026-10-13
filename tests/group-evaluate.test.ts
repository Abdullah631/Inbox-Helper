import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { classifyFallback } from "@/lib/fallback";
import { evaluate } from "@/lib/evaluate";
import { groupByIntent } from "@/lib/group";
import { LabeledMessageSchema, type Classification, type Message } from "@/lib/schema";

const m = (id: string): Message => ({ id, from: "", subject: "", body: id });
const c = (id: string, intent: Classification["intent"], confidence: number, flags: Classification["flags"] = []): Classification => ({
  id, intent, confidence, flags, reason: "", method: "fallback",
});

describe("groupByIntent", () => {
  it("groups in a fixed intent order and puts risky items first", () => {
    const groups = groupByIntent(
      [m("a"), m("b"), m("c"), m("d")],
      [c("a", "question", 0.9), c("b", "scheduling", 0.9), c("c", "scheduling", 0.2), c("d", "scheduling", 0.8, ["needs_human"])],
    );
    expect(groups.map((g) => g.intent)).toEqual(["scheduling", "question"]);
    expect(groups[0].items.map((i) => i.message.id)).toEqual(["d", "c", "b"]);
  });

  it("throws if a message was never classified", () => {
    expect(() => groupByIntent([m("a")], [])).toThrow(/No classification/);
  });
});

describe("evaluate", () => {
  it("computes accuracy, precision and recall", () => {
    const data = [
      { ...m("1"), expected_intent: "scheduling" as const, label_source: "human" as const },
      { ...m("2"), expected_intent: "scheduling" as const, label_source: "human" as const },
      { ...m("3"), expected_intent: "question" as const, label_source: "human" as const },
    ];
    const r = evaluate(data, [c("1", "scheduling", 1), c("2", "question", 1), c("3", "question", 1)]);
    expect(r.accuracy).toBeCloseTo(0.667, 3);
    const sched = r.perIntent.find((x) => x.intent === "scheduling")!;
    const q = r.perIntent.find((x) => x.intent === "question")!;
    expect(sched).toMatchObject({ precision: 1, recall: 0.5, support: 2 });
    expect(q).toMatchObject({ precision: 0.5, recall: 1, support: 1 });
    expect(r.confusion.scheduling.question).toBe(1);
  });
});

describe("sample dataset", () => {
  const data = z.array(LabeledMessageSchema).parse(JSON.parse(readFileSync("data/sample-inbox.json", "utf8")));

  it("is valid, has unique ids and covers every intent", () => {
    expect(new Set(data.map((d) => d.id)).size).toBe(data.length);
    expect(new Set(data.map((d) => d.expected_intent)).size).toBe(8);
  });

  // Regression floor for the keyword baseline. If you change the rules or labels
  // and this drops, look at why before lowering it.
  it("fallback baseline stays at or above 70%", () => {
    const r = evaluate(data, data.map(classifyFallback));
    expect(r.accuracy).toBeGreaterThanOrEqual(0.7);
  });
});
