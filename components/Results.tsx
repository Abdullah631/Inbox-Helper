"use client";

import { useMemo, useState, type Dispatch } from "react";
import { download } from "@/lib/client/browser";
import { groupByIntent } from "@/lib/group";
import { INTENT_INFO, type Intent } from "@/lib/intents";
import type { Action, State } from "@/lib/review-state";
import { replySubject, toCsv, type ApprovedReply } from "@/lib/review";
import { INTENT_COLOR } from "@/lib/ui";
import { ShieldIcon } from "./icons";
import { MessageCard } from "./MessageCard";

type Filter = "all" | "review" | "todo" | "done" | Intent;

export function Results({ state, dispatch, busy }: { state: State; dispatch: Dispatch<Action>; busy: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { messages, classes, reviews, run } = state;

  const groups = useMemo(() => {
    const sorted = messages.filter((m) => classes[m.id]);
    return groupByIntent(sorted, sorted.map((m) => classes[m.id]));
  }, [messages, classes]);

  const items = groups.flatMap((g) => g.items);
  const statusOf = (id: string) => reviews[id]?.status;
  const needsLook = (id: string) => (classes[id]?.flags.length ?? 0) > 0;
  const isDone = (id: string) => statusOf(id) === "approved" || statusOf(id) === "rejected";
  const approved = items.filter((i) => statusOf(i.message.id) === "approved").length;
  const rejected = items.filter((i) => statusOf(i.message.id) === "rejected").length;
  const done = approved + rejected;
  const reviewCount = items.filter((i) => needsLook(i.message.id)).length;
  const injectionCount = items.filter((i) => i.classification.flags.includes("possible_injection")).length;

  const keep = (id: string) =>
    filter === "review" ? needsLook(id) : filter === "todo" ? !isDone(id) : filter === "done" ? isDone(id) : true;
  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => keep(i.message.id)) }))
    .filter((g) => g.items.length && (["all", "review", "todo", "done"].includes(filter) || g.intent === filter));

  function approvedReplies(): ApprovedReply[] {
    return messages
      .filter((m) => reviews[m.id]?.status === "approved")
      .map((m) => ({ id: m.id, to: m.from, subject: replySubject(m.subject), body: reviews[m.id].text }));
  }

  if (!run) return null;
  return (
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
            {run.method === "llm" && run.promptVersion ? `prompt ${run.promptVersion}, ` : ""}{run.seconds.toFixed(1)}s to sort
            {run.reviewer && <><br />drafts checked by {run.reviewer}</>}
          </div>
        </div>
      </div>

      <div className="card review-bar">
        <label className="field">
          <span className="field-label">Sign replies as</span>
          <input
            value={state.recruiter}
            onChange={(e) => dispatch({ type: "setRecruiter", name: e.target.value })}
            onBlur={() => dispatch({ type: "sign" })}
            onKeyDown={(e) => e.key === "Enter" && dispatch({ type: "sign" })}
            placeholder="Your name"
            maxLength={80}
          />
        </label>
        <div className="review-progress">
          <div className="progress" role="progressbar" aria-label="Reviewed" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length}>
            <div style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
          </div>
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

      {visible.map((g) => (
        <section className="group" key={g.intent} aria-label={INTENT_INFO[g.intent].label}>
          <div className="group-head">
            <h3>
              <span className="intent-dot" style={{ background: INTENT_COLOR[g.intent] }} />
              {INTENT_INFO[g.intent].label}
              <span className="badge">{g.items.length}</span>
            </h3>
            <p>{INTENT_INFO[g.intent].description}</p>
          </div>
          <div className="group-list">
            {g.items.map(({ message, classification }) => (
              <MessageCard key={message.id} message={message} classification={classification}
                review={reviews[message.id]} busy={busy} dispatch={dispatch} />
            ))}
          </div>
        </section>
      ))}
      {visible.length === 0 && <div className="empty"><p>Nothing here with this filter.</p></div>}
    </>
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
