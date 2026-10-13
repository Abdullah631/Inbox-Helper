"use client";

import { LOW_CONFIDENCE } from "@/lib/flags";
import type { GroupedItem } from "@/lib/group";
import { INTENT_INFO, type Intent } from "@/lib/intents";
import { approvalCheck, type ReviewStatus } from "@/lib/review";
import type { Draft, Flag } from "@/lib/schema";
import { INJECTION_NOTE } from "@/lib/templates";

export type ReviewState = { draft: Draft; text: string; original: string; status: ReviewStatus };

const FLAG_UI: Record<Flag, { label: string; tone: string }> = {
  possible_injection: { label: "Possible injection", tone: "badge-danger" },
  needs_human: { label: "Needs a person", tone: "badge-warn" },
  low_confidence: { label: "Low confidence", tone: "badge-warn" },
  intent_disputed: { label: "Group disputed", tone: "badge-warn" },
};

// Tall enough to show the whole reply, counting line breaks as well as wrapping.
function textRows(text: string): number {
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 95)), 0);
  return Math.min(14, Math.max(3, lines + 1));
}

const SOURCE_LABEL: Record<Draft["source"], string> = { llm: "AI draft", template: "Template", none: "Write your own" };

type Props = {
  item: GroupedItem;
  review?: ReviewState;
  onText: (text: string) => void;
  onStatus: (status: ReviewStatus) => void;
  onReset: () => void;
  onMove: (intent: Intent) => void;
  onKeepGroup: () => void;
};

export function MessageCard({ item, review, onText, onStatus, onReset, onMove, onKeepGroup }: Props) {
  const { message: m, classification: c } = item;
  const pct = Math.round(c.confidence * 100);
  const tone = review?.status === "approved" ? " approved" : review?.status === "rejected" ? " rejected"
    : c.flags.includes("possible_injection") ? " injection" : c.flags.length ? " flagged" : "";
  const dispute = c.flags.includes("intent_disputed") ? review?.draft.dispute : null;

  return (
    <article className={`card msg${tone}`}>
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
            <button type="button" className="btn btn-sm" onClick={() => onMove(dispute.suggested)}>
              Move to {INTENT_INFO[dispute.suggested].label}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onKeepGroup}>Keep</button>
          </span>
        </div>
      )}

      {review ? <DraftEditor review={review} onText={onText} onStatus={onStatus} onReset={onReset} /> : null}
    </article>
  );
}

function DraftEditor({ review, onText, onStatus, onReset }: Pick<Props, "onText" | "onStatus" | "onReset"> & { review: ReviewState }) {
  const check = approvalCheck(review.text);
  const done = review.status !== "pending";
  const blockedReason = check.issues.length
    ? "Fix the problems listed before approving."
    : check.placeholders.length
      ? `Fill in ${check.placeholders.join(", ")} first.`
      : "";

  if (review.status === "rejected") {
    return (
      <div className="draft draft-done">
        <span className="badge">No reply</span>
        <span className="muted-text">You chose not to reply to this one.</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onStatus("pending")}>Undo</button>
      </div>
    );
  }

  return (
    <div className="draft">
      <div className="draft-head">
        <span className="draft-title">Reply</span>
        <span className="badge">{SOURCE_LABEL[review.draft.source]}</span>
        {review.status === "approved" && <span className="badge badge-ok">Approved</span>}
      </div>

      {review.draft.source === "none" && !review.text && <p className="draft-note">{INJECTION_NOTE}</p>}

      <textarea
        className="draft-text"
        value={review.text}
        readOnly={done}
        rows={textRows(review.text)}
        onChange={(e) => onText(e.target.value)}
        aria-label="Reply draft"
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

      <div className="draft-actions">
        {done ? (
          <button type="button" className="btn btn-sm" onClick={() => onStatus("pending")}>Edit again</button>
        ) : (
          <>
            <button type="button" className="btn btn-sm btn-primary" disabled={!check.canApprove} title={blockedReason || "Approve this reply"}
              onClick={() => onStatus("approved")}>
              Approve
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onStatus("rejected")}>Don&apos;t reply</button>
            {review.text !== review.original && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>Reset draft</button>
            )}
            {blockedReason && <span className="draft-blocked">{blockedReason}</span>}
          </>
        )}
      </div>
    </div>
  );
}
