"use client";

import { useRef } from "react";
import { CLIENT_LIMITS } from "@/lib/limits";
import type { ParseResult } from "@/lib/parse";
import type { Mode } from "@/lib/schema";
import { FORMAT_LABEL, MODE_HELP } from "@/lib/ui";
import type { Stage } from "@/hooks/useSortAndDraft";
import { FileIcon, SparkIcon, UploadIcon, XIcon } from "./icons";
import { Segmented } from "./Segmented";

type Props = {
  raw: string;
  onRawChange: (raw: string) => void;
  parsed: ParseResult;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  // null while /api/config is loading.
  llmAvailable: boolean | null;
  stage: Stage | null;
  onRun: () => void;
  onCancel: () => void;
  onLoadSample: () => void;
  onClear: () => void;
  onError: (message: string) => void;
};

export function Composer(p: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = p.stage !== null;
  const canRun = p.parsed.messages.length > 0 && !busy;
  // Shown as you type, so "1 problem" always comes with the reason (Day 5: it didn't,
  // and an upload with 0 usable messages left no way to find out why).
  const problems = p.parsed.errors.filter((e) => e !== "Input is empty.");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > CLIENT_LIMITS.uploadBytesMax) {
      p.onError(`That file is over ${CLIENT_LIMITS.uploadBytesMax / 1_000_000} MB. Split it up and try again.`);
      return;
    }
    p.onRawChange(await file.text());
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canRun) {
      e.preventDefault();
      p.onRun();
    }
  }

  return (
    <section className="card composer" aria-label="Messages to sort">
      <div className="composer-head">
        <h2>Messages</h2>
        <div className="mode-row">
          <span className="field-label" id="mode-label">Classifier</span>
          <Segmented<Mode>
            label="Classifier"
            value={p.mode}
            onChange={p.onModeChange}
            options={[
              { value: "auto", label: "Auto", title: MODE_HELP.auto },
              {
                value: "llm",
                label: <><SparkIcon width={13} height={13} />{p.llmAvailable === false ? "AI (no key)" : "AI"}</>,
                disabled: p.llmAvailable === false,
                title: p.llmAvailable === false ? "The server has no GROQ_API_KEY or GEMINI_API_KEY" : MODE_HELP.llm,
              },
              { value: "keyword", label: "Keywords", title: MODE_HELP.keyword },
            ]}
          />
        </div>
      </div>

      <label htmlFor="inbox" className="sr-only">Candidate messages</label>
      <textarea
        id="inbox"
        value={p.raw}
        onChange={(e) => p.onRawChange(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        placeholder={"Paste JSON, CSV with a body column, or plain text with --- between messages.\n\nHi, any update on my application?\n---\nCould we move Thursday's interview to Friday?"}
      />

      {problems.length > 0 && (
        <ul className="input-problems" aria-live="polite">
          {problems.slice(0, MAX_SHOWN).map((e, i) => <li key={i}>{e}</li>)}
          {problems.length > MAX_SHOWN && <li>and {problems.length - MAX_SHOWN} more</li>}
        </ul>
      )}

      {p.stage && (
        <div className="progress" role="progressbar" aria-label={p.stage.label} aria-valuenow={p.stage.done} aria-valuemin={0} aria-valuemax={p.stage.total}>
          <div style={{ width: `${(p.stage.done / Math.max(1, p.stage.total)) * 100}%` }} />
        </div>
      )}

      <div className="composer-foot">
        <div className="toolbar">
          <button className="btn" type="button" onClick={p.onLoadSample} disabled={busy}>
            <FileIcon /> Load sample
          </button>
          <button className="btn" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            <UploadIcon /> Upload file
          </button>
          <input ref={fileInput} type="file" accept=".json,.csv,.txt,application/json,text/csv,text/plain" hidden onChange={onFile} />
          <button className="btn btn-ghost" type="button" disabled={!p.raw || busy} onClick={p.onClear}>
            <XIcon /> Clear
          </button>
          <InputStatus parsed={p.parsed} />
        </div>
        {busy ? (
          <button className="btn" type="button" onClick={p.onCancel}>
            {p.stage!.label} {p.stage!.done}/{p.stage!.total}... Stop
          </button>
        ) : (
          <button className="btn btn-primary" type="button" onClick={p.onRun} disabled={!canRun}>
            Sort and draft
            <span className="kbd-hint">Ctrl/Cmd + Enter</span>
          </button>
        )}
      </div>
    </section>
  );
}

const MAX_SHOWN = 5;

function InputStatus({ parsed }: { parsed: ParseResult }) {
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
