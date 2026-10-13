"use client";

import { useState } from "react";
import sample from "@/data/sample-inbox.json";
import { groupByIntent, type Group } from "@/lib/group";
import { INTENT_INFO } from "@/lib/intents";
import { parseInbox } from "@/lib/parse";
import type { Classification } from "@/lib/schema";

// Strip the labels so the demo input looks like a real inbox.
const SAMPLE_TEXT = JSON.stringify(
  sample.map(({ id, from, subject, body }) => ({ id, from, subject, body })),
  null,
  2,
);

const FLAG_LABEL: Record<Classification["flags"][number], string> = {
  possible_injection: "possible injection",
  needs_human: "needs human",
  low_confidence: "low confidence",
};

export default function Home() {
  const [raw, setRaw] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function classify() {
    setLoading(true);
    setGroups(null);
    const { messages, errors: parseErrors } = parseInbox(raw);
    setErrors(parseErrors);

    if (messages.length) {
      try {
        const res = await fetch("/api/classify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error([data.error, ...(data.issues ?? [])].join(" "));
        setGroups(groupByIntent(messages, data.classifications));
      } catch (e) {
        setErrors((prev) => [...prev, (e as Error).message]);
      }
    }
    setLoading(false);
  }

  const all = groups?.flatMap((g) => g.items) ?? [];
  const flagged = all.filter((i) => i.classification.flags.length).length;

  return (
    <main>
      <h1>Inbox Helper</h1>
      <p className="muted">
        Paste candidate messages as JSON, CSV (with a <code>body</code> column) or plain text separated by{" "}
        <code>---</code>. Messages are grouped by what the candidate wants. Nothing is ever sent automatically.
      </p>

      <div className="row">
        <button onClick={() => setRaw(SAMPLE_TEXT)}>Load sample inbox (60)</button>
        <button onClick={() => { setRaw(""); setGroups(null); setErrors([]); }}>Clear</button>
      </div>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={"Hi, any update on my application?\n---\nCould we move the interview to Friday?"}
        aria-label="Candidate messages"
      />

      <div className="row">
        <button className="primary" onClick={classify} disabled={!raw.trim() || loading}>
          {loading ? "Classifying..." : "Group messages"}
        </button>
        <span className="muted">Classifier: keyword fallback (LLM arrives Day 2)</span>
      </div>

      {errors.length > 0 && (
        <div className="errors" role="alert">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {groups && (
        <>
          <div className="summary">
            <span className="chip">{all.length} messages</span>
            <span className="chip">{groups.length} groups</span>
            <span className="chip">{flagged} flagged for review</span>
          </div>

          {groups.map((g) => (
            <section className="group" key={g.intent}>
              <h2>
                {INTENT_INFO[g.intent].label} <span className="muted">({g.items.length})</span>
              </h2>
              <p className="muted">{INTENT_INFO[g.intent].description}</p>

              {g.items.map(({ message, classification: c }) => (
                <article className="card" key={message.id}>
                  <header>
                    <span>
                      <strong>{message.from}</strong>
                      {message.subject && <> - {message.subject}</>}
                    </span>
                    <span>
                      <span className="muted">conf {c.confidence.toFixed(2)}</span>
                      {c.flags.map((f) => (
                        <span key={f} className={`flag ${f}`}>{FLAG_LABEL[f]}</span>
                      ))}
                    </span>
                  </header>
                  <p>{message.body}</p>
                  <div className="muted">{c.reason}</div>
                </article>
              ))}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
