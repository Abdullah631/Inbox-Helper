"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import sample from "@/data/sample-inbox.json";
import { FileIcon, ShieldIcon, SparkIcon, UploadIcon, XIcon } from "@/components/icons";
import { MessageCard } from "@/components/MessageCard";
import { Segmented } from "@/components/Segmented";
import { groupByIntent, type Group } from "@/lib/group";
import { INTENT_INFO, type Intent } from "@/lib/intents";
import { parseInbox } from "@/lib/parse";
import type { Classification, Message } from "@/lib/schema";

type Mode = "auto" | "llm" | "keyword";
type Config = { llmAvailable: boolean; provider: string | null; model: string | null; promptVersion: string | null };
type RunInfo = { method: string; model?: string; promptVersion?: string; seconds: number };
type Filter = "all" | "review" | Intent;

// Small requests keep each serverless call well under the time limit and let us show progress.
const CHUNK = 20;
const MODE_KEY = "inbox-helper-mode";

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

export default function Home() {
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [config, setConfig] = useState<Config | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => setConfig(null));
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === "auto" || saved === "llm" || saved === "keyword") setMode(saved);
    } catch {}
  }, []);

  // If AI isn't configured on the server, don't leave the user on a mode that will fail.
  const effectiveMode: Mode = mode === "llm" && config && !config.llmAvailable ? "auto" : mode;

  const parsed = useMemo(() => parseInbox(raw), [raw]);
  const loading = progress !== null;
  const canRun = parsed.messages.length > 0 && !loading;

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

  async function classify() {
    const messages = parsed.messages;
    if (!messages.length) return;
    setErrors(parsed.errors.filter((e) => e !== "Input is empty."));
    setWarnings([]);
    setGroups(null);
    setFilter("all");
    setProgress({ done: 0, total: messages.length });
    const started = performance.now();

    const all: Classification[] = [];
    const runWarnings: string[] = [];
    let info: Omit<RunInfo, "seconds"> = { method: "keyword" };

    try {
      for (let i = 0; i < messages.length; i += CHUNK) {
        const chunk: Message[] = messages.slice(i, i + CHUNK);
        const res = await fetch("/api/classify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: chunk, mode: effectiveMode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error([data.error, ...(data.issues ?? [])].join(" "));
        all.push(...data.classifications);
        runWarnings.push(...data.warnings);
        info = { method: data.method, model: data.model, promptVersion: data.promptVersion };
        setProgress({ done: Math.min(i + CHUNK, messages.length), total: messages.length });
      }
      setGroups(groupByIntent(messages, all));
      setRun({ ...info, seconds: (performance.now() - started) / 1000 });
      setWarnings([...new Set(runWarnings)]);
    } catch (e) {
      setErrors((prev) => [...prev, (e as Error).message]);
    } finally {
      setProgress(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canRun) {
      e.preventDefault();
      classify();
    }
  }

  const items = groups?.flatMap((g) => g.items) ?? [];
  const reviewCount = items.filter((i) => i.classification.flags.length).length;
  const injectionCount = items.filter((i) => i.classification.flags.includes("possible_injection")).length;

  const visibleGroups = (groups ?? [])
    .map((g) => ({
      ...g,
      items: filter === "review" ? g.items.filter((i) => i.classification.flags.length) : g.items,
    }))
    .filter((g) => g.items.length && (filter === "all" || filter === "review" || g.intent === filter));

  const aiLabel = config?.llmAvailable ? "AI" : "AI (no key)";

  return (
    <main>
      <div className="container">
        <h1 className="page-title">Sort the inbox</h1>
        <p className="page-lead">
          Paste candidate messages or upload a file. They get grouped by what each person wants, and the risky ones go to the top.
          Nothing is ever sent automatically.
        </p>

        <section className="card composer" aria-label="Messages to sort">
          <div className="composer-head">
            <h2>Messages</h2>
            <div className="mode-row">
              <span className="field-label" id="mode-label">Classifier</span>
              <Segmented<Mode>
                label="Classifier"
                value={effectiveMode}
                onChange={changeMode}
                options={[
                  { value: "auto", label: "Auto", title: "Use AI if a key is configured, otherwise keywords" },
                  { value: "llm", label: <><SparkIcon width={13} height={13} />{aiLabel}</>, disabled: config ? !config.llmAvailable : false,
                    title: config?.llmAvailable ? `${config.model}, prompt ${config.promptVersion}` : "No GROQ_API_KEY or GEMINI_API_KEY on the server" },
                  { value: "keyword", label: "Keywords", title: "Fast, deterministic, no API calls" },
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

          {progress && (
            <div className="progress" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
              <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
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
              <button className="btn btn-ghost" type="button" disabled={!raw}
                onClick={() => { setRaw(""); setGroups(null); setRun(null); setErrors([]); setWarnings([]); }}>
                <XIcon /> Clear
              </button>
              <InputStatus parsed={parsed} />
            </div>
            <button className="btn btn-primary" type="button" onClick={classify} disabled={!canRun}>
              {loading ? `Sorting ${progress.done}/${progress.total}...` : "Sort messages"}
              {!loading && <span className="kbd-hint">Ctrl/Cmd + Enter</span>}
            </button>
          </div>
        </section>

        {errors.length > 0 && (
          <div className="alert alert-danger" role="alert">
            <strong>Some input couldn&apos;t be used.</strong>
            <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="alert alert-warn" role="status">
            <ul style={{ marginLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
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
                <div className="stat-label">Need review</div>
                <div className="stat-value">{reviewCount}</div>
                <div className="stat-sub">flagged or unsure</div>
              </div>
              <div className="card stat">
                <div className="stat-label">Injection attempts</div>
                <div className="stat-value">{injectionCount}</div>
                <div className="stat-sub"><ShieldIcon width={12} height={12} style={{ verticalAlign: -1 }} /> sent to a person</div>
              </div>
              <div className="card stat">
                <div className="stat-label">Sorted by</div>
                <div className="stat-value small">{run.method === "llm" ? run.model : "Keyword rules"}</div>
                <div className="stat-sub">
                  {run.method === "llm" ? `prompt ${run.promptVersion}, ` : ""}{run.seconds.toFixed(1)}s
                </div>
              </div>
            </div>

            <div className="tabs" role="tablist" aria-label="Filter groups">
              <FilterTab current={filter} value="all" onSelect={setFilter} label="All" count={items.length} />
              <FilterTab current={filter} value="review" onSelect={setFilter} label="Needs review" count={reviewCount} />
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
                  {g.items.map((item) => <MessageCard key={item.message.id} item={item} />)}
                </div>
              </section>
            ))}
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
