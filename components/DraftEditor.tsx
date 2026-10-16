"use client";

import { useMemo, type Dispatch } from "react";
import { CONCERN_LABELS } from "@/lib/concerns";
import type { Action, ReviewState } from "@/lib/review-state";
import { approvalCheck } from "@/lib/review";
import { INJECTION_NOTE } from "@/lib/templates";
import { SOURCE_LABEL } from "@/lib/ui";

// Tall enough to show the whole reply, counting line breaks as well as wrapping.
function textRows(text: string): number {
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 95)), 0);
  return Math.min(14, Math.max(3, lines + 1));
}

export function DraftEditor({ id, review, dispatch }: { id: string; review: ReviewState; dispatch: Dispatch<Action> }) {
  const check = useMemo(() => approvalCheck(review.text), [review.text]);
  const done = review.status !== "pending";
  const concerns = review.draft.concerns ?? [];
  const needsAck = concerns.length > 0 && !review.acknowledged;
  const canApprove = check.canApprove && !needsAck;
  const blockedReason = check.issues.length
    ? "Fix the problems listed before approving."
    : check.placeholders.length
      ? `Fill in ${check.placeholders.join(", ")} first.`
      : needsAck
        ? "Tick that you've checked the AI reviewer's notes."
        : "";

  if (review.status === "rejected") {
    return (
      <div className="draft draft-done">
        <span className="badge">No reply</span>
        <span className="muted-text">You chose not to reply to this one.</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => dispatch({ type: "status", id, status: "pending" })}>Undo</button>
      </div>
    );
  }

  const editorId = `reply-${id}`;
  const hintId = `reply-hint-${id}`;
  return (
    <div className="draft">
      <div className="draft-head">
        <label className="draft-title" htmlFor={editorId}>Reply</label>
        <span className="badge">{SOURCE_LABEL[review.draft.source]}</span>
        {review.status === "approved" && <span className="badge badge-ok">Approved</span>}
      </div>

      {review.draft.source === "none" && !review.text && <p className="draft-note">{INJECTION_NOTE}</p>}

      <textarea
        id={editorId}
        className="draft-text"
        value={review.text}
        readOnly={done}
        rows={textRows(review.text)}
        aria-describedby={blockedReason ? hintId : undefined}
        onChange={(e) => dispatch({ type: "edit", id, text: e.target.value })}
        placeholder={review.draft.source === "none" ? "Write the reply yourself, if one is needed." : ""}
      />

      {!done && (check.issues.length > 0 || check.placeholders.length > 0) && (
        <ul className="draft-issues">
          {check.issues.map((i) => (
            <li key={i.kind} className="issue-block">
              {i.message}
              {i.match && <> Found: <code>{i.match}</code></>}
            </li>
          ))}
          {check.placeholders.length > 0 && (
            <li className="issue-fill">Fill in: {check.placeholders.map((p) => <code key={p}>{p}</code>)}</li>
          )}
        </ul>
      )}

      {!done && concerns.length > 0 && (
        <div className="concerns">
          <div className="concerns-head">
            AI reviewer notes
            {review.text !== review.original && <span> &middot; found before your edits</span>}
          </div>
          <ul>
            {concerns.map((c, i) => (
              <li key={i}>{CONCERN_LABELS[c.kind]}{c.quote && <>: <q>{c.quote}</q></>}</li>
            ))}
          </ul>
          <label className="ack">
            <input type="checkbox" checked={review.acknowledged} onChange={(e) => dispatch({ type: "acknowledge", id, value: e.target.checked })} />
            I&apos;ve checked these
          </label>
        </div>
      )}
      {!done && review.draft.source === "llm" && review.draft.concerns === null && (
        <p className="draft-unchecked">Not checked by the AI reviewer. Read it carefully.</p>
      )}

      <div className="draft-actions">
        {done ? (
          <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: "status", id, status: "pending" })}>Edit again</button>
        ) : (
          <>
            <button type="button" className="btn btn-sm btn-primary" disabled={!canApprove} title={blockedReason || "Approve this reply"}
              onClick={() => dispatch({ type: "status", id, status: "approved" })}>
              Approve
            </button>
            <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: "status", id, status: "rejected" })}>Don&apos;t reply</button>
            {review.text !== review.original && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => dispatch({ type: "resetDraft", id })}>Reset draft</button>
            )}
            {blockedReason && <span id={hintId} className="draft-blocked">{blockedReason}</span>}
          </>
        )}
      </div>
    </div>
  );
}
