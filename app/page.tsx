"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import sample from "@/data/sample-inbox.json";
import { FileIcon, ShieldIcon, SparkIcon, UploadIcon, XIcon } from "@/components/icons";
import { MessageCard, type ReviewState } from "@/components/MessageCard";
import { Segmented } from "@/components/Segmented";
import { computeFlags } from "@/lib/flags";
import { groupByIntent } from "@/lib/group";
import { INTENT_INFO, type Intent } from "@/lib/intents";
import { parseInbox } from "@/lib/parse";
import { fillKnownPlaceholders, replySubject, toCsv, type ApprovedReply, type ReviewStatus } from "@/lib/review";
import type { Classification, Draft, Message } from "@/lib/schema";
import { TEMPLATES } from "@/lib/templates";

type Mode = "auto" | "llm" | "keyword";
type Config = { llmAvailable: boolean; provider: string | null; model: string | null; promptVersion: string | null };
type RunInfo = { method: string; model?: string; promptVersion?: string; seconds: number; reviewer?: string };
type Filter = "all" | "review" | "todo" | "done" | Intent;
type Stage = { label: string; done: number; total: number };

// Small requests keep each serverless call well under the time limit and let us show progress.
const CLASSIFY_CHUNK = 20;
const DRAFT_CHUNK = 10;
const MODE_KEY = "inbox-helper-mode";
const NAME_KEY = "inbox-helper-recruiter";
// Review work survives a refresh (Day 4). Bump the version if the saved shape changes.
const SESSION_KEY = "inbox-helper-session-v1";
type Session = { messages: Message[]; classes: Record<string, Classification>; reviews: Record<string, ReviewState>; run: RunInfo; savedAt: string };

const INTENT_COLOR: Record<Intent, string> = {
  scheduling: "#3b82f6",
  status_check: "#8b5cf6",
  offer_compensation: "#f59e0b",
  withdrawal: "#ef4444",
  documents: "#14b8a6",
  referral: "#ec4899",
  question: "#22c55e",
  other: "#94a3b8",
};

// The demo input shouldn't show the answer key.
const SAMPLE_TEXT = JSON.stringify(sample.map(({ id, from, subject, body }) => ({ id, from, subject, body })), null, 2);
const FORMAT_LABEL = { json: "JSON", csv: "CSV", text: "plain text", empty: "" } as const;

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error([data.error, ...(data.issues ?? [])].join(" "));
  return data;
}

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [config, setConfig] = useState<Config | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [classes, setClasses] = useState<Record<string, Classification>>({});
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [run, setRun] = useState<RunInfo | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [recruiter, setRecruiter] = useState("");
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => setConfig(null));
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === "auto" || saved === "llm" || saved === "keyword") setMode(saved);
      setRecruiter(localStorage.getItem(NAME_KEY) ?? "");
      const savedSession = localStorage.getItem(SESSION_KEY);
      if (savedSession) {
        const session = JSON.parse(savedSession) as Session;
        if (session.messages?.length && session.run) {
          setMessages(session.messages);
          setClasses(session.classes);
          setReviews(session.reviews);
          setRun(session.run);
          setRestoredAt(session.savedAt);
        }
      }
    } catch {}
  }, []);

  // Save after every change once there's something sorted. Never while a run is going.
  useEffect(() => {
    if (!run || stage || !messages.length) return;
    try {
      const session: Session = { messages, classes, reviews, run, savedAt: new Date().toISOString() };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {}
  }, [messages, classes, reviews, run, stage]);

  // If AI isn't configured on the server, don't leave the user on a mode that will fail.
  const effectiveMode: Mode = mode === "llm" && config && !config.llmAvailable ? "auto" : mode;

  const parsed = useMemo(() => parseInbox(raw), [raw]);
  const loading = stage !== null;
  const canRun = parsed.messages.length > 0 && !loading;
  const sorted = messages.length > 0 && Object.keys(classes).length === messages.length;
  const groups = useMemo(
    () => (sorted ? groupByIntent(messages, messages.map((m) => classes[m.id])) : null),
    [sorted, messages, classes],
  );

  function changeMode(m: Mode) {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch {}
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) return setErrors(["That file is over 2 MB. Split it up and try again."]);
    setRaw(await file.text());
    setErrors([]);
  }

  function reset() {
    setMessages([]); setClasses({}); setReviews({}); setRun(null); setErrors([]); setWarnings([]); setFilter("all");
    setRestoredAt(null);
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  }

  async function sortAndDraft() {
    const msgs = parsed.messages;
    if (!msgs.length) return;
    reset();
    setErrors(parsed.errors.filter((e) => e !== "Input is empty."));
    setMessages(msgs);
    const started = performance.now();
    const runWarnings: string[] = [];

    try {
      // 1. Sort
      const all: Classification[] = [];
      let info: Omit<RunInfo, "seconds"> = { method: "keyword" };
      for (let i = 0; i < msgs.length; i += CLASSIFY_CHUNK) {
        setStage({ label: "Sorting", done: i, total: msgs.length });
        const data = await postJson("/api/classify", { messages: msgs.slice(i, i + CLASSIFY_CHUNK), mode: effectiveMode });
        all.push(...data.classifications);
        runWarnings.push(...data.warnings);
        info = { method: data.method, model: data.model, promptVersion: data.promptVersion };
      }
      const byId = Object.fromEntries(all.map((c) => [c.id, c]));
      setClasses(byId);
      setRun({ ...info, seconds: (performance.now() - started) / 1000 });

      // 2. Draft. Sorting results are already on screen, so this can fail without losing them.
      for (let i = 0; i < msgs.length; i += DRAFT_CHUNK) {
        setStage({ label: "Drafting replies", done: i, total: msgs.length });
        const chunk = msgs.slice(i, i + DRAFT_CHUNK);
        const data = await postJson("/api/draft", {
          items: chunk.map((message) => ({ message, classification: byId[message.id] })),
          mode: effectiveMode,
        });
        runWarnings.push(...data.warnings);
        applyDrafts(chunk, data.drafts as Draft[]);
        if (data.reviewerModel) setRun((r) => (r ? { ...r, reviewer: data.reviewerModel } : r));
      }
    } catch (e) {
      setErrors((prev) => [...prev, (e as Error).message]);
    } finally {
      setWarnings([...new Set(runWarnings)]);
      setStage(null);
    }
  }

  function applyDrafts(chunk: Message[], drafts: Draft[]) {
    const name = recruiter;
    setReviews((prev) => {
      const next = { ...prev };
      drafts.forEach((draft, j) => {
        const text = fillKnownPlaceholders(draft.reply, chunk[j], name);
        next[draft.id] = { draft, text, original: text, status: "pending" };
      });
      return next;
    });
    const disputed = drafts.filter((d) => d.dispute).map((d) => d.id);
    if (disputed.length) {
      setClasses((prev) => {
        const next = { ...prev };
        for (const id of disputed) next[id] = { ...next[id], flags: [...next[id].flags, "intent_disputed"] };
        return next;
      });
    }
  }

  function updateReview(id: string, patch: Partial<ReviewState>) {
    setReviews((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  // A person overrode the group. Their call wins, so the confidence is treated as certain.
  function moveTo(id: string, intent: Intent) {
    const message = messages.find((m) => m.id === id)!;
    const old = classes[id];
    const injection = old.flags.includes("possible_injection");
    setClasses((prev) => ({
      ...prev,
      [id]: { ...old, intent, confidence: 1, flags: computeFlags(message, intent, 1, injection),
        reason: `Moved by you from ${INTENT_INFO[old.intent].label}.` },
    }));
    const r = reviews[id];
    if (r?.draft.source === "template" && r.status === "pending") {
      const text = fillKnownPlaceholders(TEMPLATES[intent], message, recruiter);
      updateReview(id, { text, original: text });
    }
  }

  function keepGroup(id: string) {
    setClasses((prev) => ({ ...prev, [id]: { ...prev[id], flags: prev[id].flags.filter((f) => f !== "intent_disputed") } }));
  }

  function signAll() {
    try { localStorage.setItem(NAME_KEY, recruiter); } catch {}
    if (!recruiter.trim()) return;
    setReviews((prev) => {
      const next = { ...prev };
      for (const [id, r] of Object.entries(prev)) {
        if (r.status !== "pending") continue;
        next[id] = { ...r, text: r.text.replaceAll("[RECRUITER_NAME]", recruiter.trim()), original: r.original.replaceAll("[RECRUITER_NAME]", recruiter.trim()) };
      }
      return next;
    });
  }

  function approvedReplies(): ApprovedReply[] {
    return messages
      .filter((m) => reviews[m.id]?.status === "approved")
      .map((m) => ({ id: m.id, to: m.from, subject: replySubject(m.subject), body: reviews[m.id].text }));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canRun) {
      e.preventDefault();
      sortAndDraft();
    }
  }

  const items = groups?.flatMap((g) => g.items) ?? [];
  const needsReview = (id: string) => classes[id]?.flags.length > 0;
  const statusOf = (id: string): ReviewStatus | undefined => reviews[id]?.status;
  const reviewCount = items.filter((i) => needsReview(i.message.id)).length;
  const injectionCount = items.filter((i) => i.classification.flags.includes("possible_injection")).length;
  const approved = items.filter((i) => statusOf(i.message.id) === "approved").length;
  const rejected = items.filter((i) => statusOf(i.message.id) === "rejected").length;
  const done = approved + rejected;

  const keep = (id: string) =>
    filter === "review" ? needsReview(id)
      : filter === "todo" ? statusOf(id) !== "approved" && statusOf(id) !== "rejected"
        : filter === "done" ? statusOf(id) === "approved" || statusOf(id) === "rejected"
          : true;
  const visibleGroups = (groups ?? [])
    .map((g) => ({ ...g, items: g.items.filter((i) => keep(i.message.id)) }))
    .filter((g) => g.items.length && (["all", "review", "todo", "done"].includes(filter) || g.intent === filter));

  const aiLabel = config?.llmAvailable ? "AI" : "AI (no key)";

  return (
    <main>
      <div className="container">
        <h1 className="page-title">Sort the inbox</h1>
        <p className="page-lead">
          Paste candidate messages or upload a file. They get grouped by what each person wants, each one gets a draft
          reply, and you approve or edit every reply. Nothing is ever sent automatically.
        </p>

        <section className="card composer" aria-label="Messages to sort">
          <div className="composer-head">
            <h2>Messages</h2>
            <div className="mode-row">
              <span className="field-label">Classifier</span>
              <Segmented<Mode>
                label="Classifier"
                value={effectiveMode}
                onChange={changeMode}
                options={[
                  { value: "auto", label: "Auto", title: "Use AI if a key is configured, otherwise keywords and templates" },
                  { value: "llm", label: <><SparkIcon width={13} height={13} />{aiLabel}</>, disabled: config ? !config.llmAvailable : false,
                    title: config?.llmAvailable ? `${config.model}, prompt ${config.promptVersion}` : "No GROQ_API_KEY or GEMINI_API_KEY on the server" },
                  { value: "keyword", label: "Keywords", title: "Keyword sorting and template replies. No API calls" },
                ]}
              />
            </div>
          </div>

          <label htmlFor="inbox" className="sr-only">Candidate messages</label>
          <textarea
            id="inbox"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            placeholder={"Paste JSON, CSV with a body column, or plain text with --- between messages.\n\nHi, any update on my application?\n---\nCould we move Thursday's interview to Friday?"}
          />

          {stage && (
            <div className="progress" role="progressbar" aria-valuenow={stage.done} aria-valuemax={stage.total}>
              <div style={{ width: `${(stage.done / stage.total) * 100}%` }} />
            </div>
          )}

          <div className="composer-foot">
            <div className="toolbar">
              <button className="btn" type="button" onClick={() => { setRaw(SAMPLE_TEXT); setErrors([]); }}>
                <FileIcon /> Load sample
              </button>
              <button className="btn" type="button" onClick={() => fileInput.current?.click()}>
                <UploadIcon /> Upload file
              </button>
              <input ref={fileInput} type="file" accept=".json,.csv,.txt,application/json,text/csv,text/plain" hidden onChange={onFile} />
              <button className="btn btn-ghost" type="button" disabled={!raw || loading} onClick={() => { setRaw(""); reset(); }}>
                <XIcon /> Clear
              </button>
              <InputStatus parsed={parsed} />
            </div>
            <button className="btn btn-primary" type="button" onClick={sortAndDraft} disabled={!canRun}>
              {stage ? `${stage.label}...` : "Sort and draft"}
              {!stage && <span className="kbd-hint">Ctrl/Cmd + Enter</span>}
            </button>
          </div>
        </section>

        {errors.length > 0 && (
          <div className="alert alert-danger" role="alert">
            <strong>Something didn&apos;t work.</strong>
            <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="alert alert-warn" role="status">
            <ul style={{ marginLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        {restoredAt && groups && (
          <div className="alert alert-warn restored" role="status">
            <span>Picked up where you left off (saved {new Date(restoredAt).toLocaleString()}).</span>
            <button type="button" className="btn btn-sm" onClick={reset}>Start over</button>
          </div>
        )}

        {groups && run ? (
          <>
            <div className="stats">
              <div className="card stat">
                <div className="stat-label">Messages</div>
                <div className="stat-value">{items.length}</div>
                <div className="stat-sub">in {groups.length} groups</div>
              </div>
              <div className="card stat">
                <div className="stat-label">Need a closer look</div>
                <div className="stat-value">{reviewCount}</div>
                <div className="stat-sub">
                  <ShieldIcon width={12} height={12} style={{ verticalAlign: -1 }} /> incl. {injectionCount} injection attempt{injectionCount === 1 ? "" : "s"}
                </div>
              </div>
              <div className="card stat">
                <div className="stat-label">Reviewed</div>
                <div className="stat-value">{done}<span className="stat-of"> / {items.length}</span></div>
                <div className="stat-sub">{approved} approved, {rejected} no reply</div>
              </div>
              <div className="card stat">
                <div className="stat-label">Sorted by</div>
                <div className="stat-value small">{run.method === "llm" ? run.model : "Keyword rules"}</div>
                <div className="stat-sub">
                  {run.method === "llm" ? `prompt ${run.promptVersion}, ` : ""}{run.seconds.toFixed(1)}s to sort
                  {run.reviewer && <><br />drafts checked by {run.reviewer}</>}
                </div>
              </div>
            </div>

            <div className="card review-bar">
              <label className="field">
                <span className="field-label">Sign replies as</span>
                <input value={recruiter} onChange={(e) => setRecruiter(e.target.value)} onBlur={signAll}
                  onKeyDown={(e) => e.key === "Enter" && signAll()} placeholder="Your name" />
              </label>
              <div className="review-progress">
                <div className="progress"><div style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div>
                <span>{done} of {items.length} reviewed</span>
              </div>
              <div className="toolbar">
                <button type="button" className="btn btn-sm" disabled={!approved}
                  onClick={() => download("approved-replies.csv", "text/csv", toCsv(approvedReplies()))}>Export CSV</button>
                <button type="button" className="btn btn-sm" disabled={!approved}
                  onClick={() => download("approved-replies.json", "application/json", JSON.stringify(approvedReplies(), null, 2))}>Export JSON</button>
              </div>
            </div>

            <div className="tabs" role="tablist" aria-label="Filter messages">
              <FilterTab current={filter} value="all" onSelect={setFilter} label="All" count={items.length} />
              <FilterTab current={filter} value="review" onSelect={setFilter} label="Needs a look" count={reviewCount} />
              <FilterTab current={filter} value="todo" onSelect={setFilter} label="To do" count={items.length - done} />
              <FilterTab current={filter} value="done" onSelect={setFilter} label="Done" count={done} />
              {groups.map((g) => (
                <FilterTab key={g.intent} current={filter} value={g.intent} onSelect={setFilter}
                  label={INTENT_INFO[g.intent].label} count={g.items.length} color={INTENT_COLOR[g.intent]} />
              ))}
            </div>

            {visibleGroups.map((g) => (
              <section className="group" key={g.intent}>
                <div className="group-head">
                  <h3>
                    <span className="intent-dot" style={{ background: INTENT_COLOR[g.intent] }} />
                    {INTENT_INFO[g.intent].label}
                    <span className="badge">{g.items.length}</span>
                  </h3>
                  <p>{INTENT_INFO[g.intent].description}</p>
                </div>
                <div className="group-list">
                  {g.items.map((item) => {
                    const id = item.message.id;
                    return (
                      <MessageCard
                        key={id}
                        item={item}
                        review={reviews[id]}
                        onText={(text) => updateReview(id, { text })}
                        onAcknowledge={(acknowledged) => updateReview(id, { acknowledged })}
                        onStatus={(status) => updateReview(id, { status })}
                        onReset={() => updateReview(id, { text: reviews[id].original })}
                        onMove={(intent) => moveTo(id, intent)}
                        onKeepGroup={() => keepGroup(id)}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
            {visibleGroups.length === 0 && <div className="empty"><p>Nothing here with this filter.</p></div>}
          </>
        ) : (
          !loading && (
            <div className="empty">
              <h3>Nothing sorted yet</h3>
              <p>Load the sample inbox to see how it works, or paste your own messages.</p>
            </div>
          )
        )}
      </div>
    </main>
  );
}

function InputStatus({ parsed }: { parsed: ReturnType<typeof parseInbox> }) {
  if (parsed.format === "empty") return null;
  const n = parsed.messages.length;
  const bad = parsed.errors.length > 0;
  return (
    <span className={`input-status${bad && !n ? " bad" : ""}`} aria-live="polite">
      <span className="dot" />
      {n} message{n === 1 ? "" : "s"} &middot; {FORMAT_LABEL[parsed.format]}
      {bad && <> &middot; {parsed.errors.length} problem{parsed.errors.length === 1 ? "" : "s"}</>}
    </span>
  );
}

function FilterTab({ current, value, onSelect, label, count, color }: {
  current: Filter; value: Filter; onSelect: (f: Filter) => void; label: string; count: number; color?: string;
}) {
  return (
    <button type="button" role="tab" className="tab" aria-selected={current === value} onClick={() => onSelect(value)}>
      {color && <span className="intent-dot" style={{ background: color }} />}
      {label} <span className="count">{count}</span>
    </button>
  );
}
