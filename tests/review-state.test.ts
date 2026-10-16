import { describe, expect, it } from "vitest";
import { initialState, reducer, type Action, type State } from "@/lib/review-state";
import { parseSession, serializeSession } from "@/lib/session";
import type { Classification, Draft, Message } from "@/lib/schema";
import { TEMPLATES } from "@/lib/templates";

const msg = (id: string, from = "anna.smith@mail.com"): Message => ({ id, from, subject: "", body: "Any update?" });
const cls = (id: string, intent: Classification["intent"] = "status_check", flags: Classification["flags"] = []): Classification =>
  ({ id, intent, confidence: 0.9, flags, reason: "", method: "llm" });
const draft = (id: string, extra: Partial<Draft> = {}): Draft =>
  ({ id, reply: "Hi [NAME], thanks. [RECRUITER_NAME]", source: "llm", dispute: null, concerns: null, ...extra });

const run = (...actions: Action[]) => actions.reduce(reducer, initialState);
const sorted = (...extra: Action[]): State =>
  run(
    { type: "setRecruiter", name: "Sara" },
    { type: "start", messages: [msg("a"), msg("b")] },
    { type: "classified", classifications: [cls("a"), cls("b", "offer_compensation", ["needs_human"])] },
    { type: "sorted", run: { method: "llm", seconds: 1 } },
    ...extra,
  );

describe("review reducer", () => {
  it("fills names in drafts and keeps the recruiter across runs", () => {
    const s = sorted({ type: "drafted", drafts: [draft("a")], sentIntents: { a: "status_check" } });
    expect(s.reviews.a.text).toBe("Hi Anna, thanks. Sara");
    expect(run({ type: "setRecruiter", name: "Sara" }, { type: "reset" }).recruiter).toBe("Sara");
  });

  it("doesn't let a late draft overwrite a group the person changed meanwhile", () => {
    const s = sorted(
      { type: "move", id: "a", intent: "withdrawal" },
      { type: "drafted", drafts: [draft("a", { dispute: { suggested: "scheduling" } })], sentIntents: { a: "status_check" } },
    );
    expect(s.classes.a.intent).toBe("withdrawal");
    expect(s.classes.a.flags).not.toContain("intent_disputed");
    expect(s.reviews.a.draft.source).toBe("template");
    expect(s.reviews.a.text).toContain(TEMPLATES.withdrawal.slice(12, 40));
  });

  it("marks disputes and lets the person keep the group or move it", () => {
    const disputed = sorted({ type: "drafted", drafts: [draft("a", { dispute: { suggested: "scheduling" } })], sentIntents: { a: "status_check" } });
    expect(disputed.classes.a.flags).toContain("intent_disputed");
    expect(reducer(disputed, { type: "keepGroup", id: "a" }).classes.a.flags).not.toContain("intent_disputed");
    const moved = reducer(disputed, { type: "move", id: "a", intent: "scheduling" });
    expect(moved.classes.a).toMatchObject({ intent: "scheduling", confidence: 1 });
    expect(moved.classes.a.reason).toMatch(/Moved by you/);
  });

  it("keeps the injection flag and needs_human when a person moves a message", () => {
    const s = run(
      { type: "start", messages: [msg("x")] },
      { type: "classified", classifications: [cls("x", "other", ["possible_injection", "needs_human"])] },
      { type: "move", id: "x", intent: "status_check" },
    );
    expect(s.classes.x.flags).toEqual(expect.arrayContaining(["possible_injection", "needs_human"]));
  });

  it("only edits pending replies, and resets to the original", () => {
    let s = sorted({ type: "drafted", drafts: [draft("a")], sentIntents: { a: "status_check" } });
    s = reducer(s, { type: "edit", id: "a", text: "changed" });
    expect(reducer(s, { type: "resetDraft", id: "a" }).reviews.a.text).toBe("Hi Anna, thanks. Sara");
    s = reducer(s, { type: "status", id: "a", status: "approved" });
    expect(reducer(s, { type: "edit", id: "a", text: "sneaky" }).reviews.a.text).toBe("changed");
  });

  it("drops messages the run couldn't sort, so every card has a group", () => {
    const s = run(
      { type: "start", messages: [msg("a"), msg("b")] },
      { type: "classified", classifications: [cls("a")] },
      { type: "dropUnsorted" },
    );
    expect(s.messages.map((m) => m.id)).toEqual(["a"]);
  });

  it("ignores classifications for messages it doesn't know", () => {
    const s = run({ type: "start", messages: [msg("a")] }, { type: "classified", classifications: [cls("zzz")] });
    expect(s.classes).toEqual({});
  });

  it("uses templates when drafting failed, and never drafts for injection", () => {
    const s = run(
      { type: "start", messages: [msg("a"), msg("x")] },
      { type: "classified", classifications: [cls("a", "documents"), cls("x", "other", ["possible_injection", "needs_human"])] },
      { type: "useTemplates", ids: ["a", "x"] },
    );
    expect(s.reviews.a.draft.source).toBe("template");
    expect(s.reviews.x.draft).toMatchObject({ source: "none", reply: "" });
  });

  it("names every reviewer model across draft requests, without repeats", () => {
    const s = sorted(
      { type: "drafted", drafts: [draft("a")], sentIntents: {}, reviewer: "gem" },
      { type: "drafted", drafts: [draft("b")], sentIntents: {}, reviewer: "groq + gem" },
    );
    expect(s.run?.reviewer).toBe("gem + groq");
  });

  it("signs pending replies only", () => {
    let s = run(
      { type: "start", messages: [msg("a"), msg("b")] },
      { type: "classified", classifications: [cls("a"), cls("b")] },
      { type: "drafted", drafts: [draft("a"), draft("b")], sentIntents: {} },
      { type: "status", id: "b", status: "approved" },
    );
    s = reducer(reducer(s, { type: "setRecruiter", name: "Lee" }), { type: "sign" });
    expect(s.reviews.a.text).toMatch(/Lee$/);
    expect(s.reviews.b.text).toMatch(/\[RECRUITER_NAME\]$/);
  });
});

describe("saved sessions", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const good = () => serializeSession(sorted({ type: "drafted", drafts: [draft("a")], sentIntents: {} }), new Date(now))!;

  it("round-trips a real session", () => {
    const back = parseSession(good(), now);
    expect(back?.messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(back?.reviews.a.text).toBe("Hi Anna, thanks. Sara");
  });

  it("doesn't save before anything is sorted", () => {
    expect(serializeSession(initialState)).toBeNull();
  });

  it.each([
    ["bad JSON", "{not json"],
    ["wrong shape", JSON.stringify({ messages: [{ id: "a", body: "x" }] })],
    ["empty", ""],
  ])("rejects %s", (_name, raw) => {
    expect(parseSession(raw, now)).toBeNull();
  });

  it("rejects a session with a message that has no group, or a review for a stranger", () => {
    const s = JSON.parse(good());
    delete s.classes.b;
    expect(parseSession(JSON.stringify(s), now)).toBeNull();
    const t = JSON.parse(good());
    t.reviews.zzz = t.reviews.a;
    expect(parseSession(JSON.stringify(t), now)).toBeNull();
  });

  it("loads sessions saved before Day 5, when the tick was true/false, as not ticked", () => {
    const s = JSON.parse(good());
    s.reviews.a.acknowledged = true;
    expect(parseSession(JSON.stringify(s), now)?.reviews.a.acknowledged).toBeNull();
  });

  it("forgets sessions older than the time limit", () => {
    expect(parseSession(good(), now + 8 * 24 * 3600 * 1000)).toBeNull();
    expect(parseSession(good(), now + 60_000)).not.toBeNull();
  });
});
