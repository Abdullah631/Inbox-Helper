"use client";

import { memo, type Dispatch } from "react";
import { LOW_CONFIDENCE } from "@/lib/limits";
import { INTENT_INFO } from "@/lib/intents";
import type { Action, ReviewState } from "@/lib/review-state";
import type { Classification, Message } from "@/lib/schema";
import { FLAG_UI } from "@/lib/ui";
import { DraftEditor } from "./DraftEditor";

type Props = {
  message: Message;
  classification: Classification;
  review?: ReviewState;
  // True while a run is in progress: moving a message then would race with its draft.
  busy: boolean;
  dispatch: Dispatch<Action>;
};

// Memoized and given stable props (state objects and dispatch), so typing in one reply
// re-renders that card only, not every card on the page (Day 5 review).
export const MessageCard = memo(function MessageCard({ message: m, classification: c, review, busy, dispatch }: Props) {
  const pct = Math.round(c.confidence * 100);
  const tone =
    review?.status === "approved" ? " approved"
      : review?.status === "rejected" ? " rejected"
        : c.flags.includes("possible_injection") ? " injection"
          : c.flags.length ? " flagged" : "";
  const dispute = c.flags.includes("intent_disputed") ? review?.draft.dispute : null;

  return (
    <article className={`card msg${tone}`} aria-label={`Message from ${m.from}`}>
      <div className="msg-top">
        <div className="msg-from">
          <strong>{m.from}</strong>
          {m.subject && <span> &middot; {m.subject}</span>}
        </div>
        <div className="msg-meta">
          {c.flags.map((f) => (
            <span key={f} className={`badge ${FLAG_UI[f].tone}`}>{FLAG_UI[f].label}</span>
          ))}
          <span className="meter" title={`Classifier confidence ${pct}%`}>
            <span className="meter-track">
              <span className={`meter-fill${c.confidence < LOW_CONFIDENCE ? " low" : ""}`} style={{ width: `${pct}%` }} />
            </span>
            {pct}%
          </span>
        </div>
      </div>

      <p className="msg-body">{m.body}</p>
      <div className="msg-reason">
        <span className="badge">{c.method === "llm" ? "AI" : "Keywords"}</span>
        <span>{c.reason}</span>
      </div>

      {dispute && (
        <div className="dispute">
          <span>
            When writing the reply, the AI read this as <strong>{INTENT_INFO[dispute.suggested].label}</strong>, not{" "}
            {INTENT_INFO[c.intent].label}.
          </span>
          <span className="dispute-actions">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => dispatch({ type: "move", id: m.id, intent: dispute.suggested })}>
              Move to {INTENT_INFO[dispute.suggested].label}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => dispatch({ type: "keepGroup", id: m.id })}>
              Keep
            </button>
          </span>
        </div>
      )}

      {review ? <DraftEditor id={m.id} review={review} source={m} dispatch={dispatch} /> : busy ? <p className="draft-unchecked">Writing a draft...</p> : null}
    </article>
  );
});
