import type { Concern } from "./concerns";
import { copiedFromMessage } from "./echo";
import { checkDraft, placeholdersIn, type Issue } from "./guardrails";
import type { Message } from "./schema";

export type ReviewStatus = "pending" | "approved" | "rejected";

// Guess a first name from an address like "aisha.khan@mail.com". Only used to
// prefill [NAME] in a draft the recruiter can see and edit, never sent as is.
export function guessFirstName(from: string): string | null {
  if (!from.includes("@")) return null; // e.g. the parser's "unknown" default
  const local = from.split("@")[0];
  const first = local.split(/[._-]/)[0];
  if (!first || first.length < 2 || /\d/.test(first) || !/^[a-z]+$/i.test(first)) return null;
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

export function fillKnownPlaceholders(text: string, message: Message, recruiterName: string): string {
  let out = text;
  const name = guessFirstName(message.from);
  if (name) out = out.replaceAll("[NAME]", name);
  if (recruiterName.trim()) out = out.replaceAll("[RECRUITER_NAME]", recruiterName.trim());
  return out;
}

export type ApprovalCheck = {
  canApprove: boolean;
  // Hard blocks: the text has to change.
  issues: Issue[];
  placeholders: string[];
  // Soft warnings: the reviewer ticks that they checked them.
  concerns: Concern[];
  copied: string[];
  // Identifies this exact set of soft warnings. A tick is stored against it, so a new
  // warning (say, after an edit) needs a new tick.
  warningsKey: string | null;
  needsAck: boolean;
};

type CheckOptions = {
  // The candidate's message, for the copied-text check (lib/echo.ts).
  source?: Pick<Message, "subject" | "body">;
  // Notes from the AI reviewer (lib/critic.ts).
  concerns?: Concern[] | null;
  // The warningsKey the reviewer ticked, if any.
  acknowledged?: string | null;
};

// Re-checked on every edit. Approve needs: no guardrail issues, no placeholders left,
// and any soft warnings ticked as checked.
export function approvalCheck(text: string, opts: CheckOptions = {}): ApprovalCheck {
  const issues = checkDraft(text);
  const placeholders = placeholdersIn(text);
  const concerns = opts.concerns ?? [];
  const copied = opts.source ? copiedFromMessage(text, opts.source) : [];
  const warningsKey = concerns.length || copied.length ? JSON.stringify({ concerns, copied }) : null;
  const needsAck = warningsKey !== null && opts.acknowledged !== warningsKey;
  return {
    canApprove: issues.length === 0 && placeholders.length === 0 && !needsAck,
    issues,
    placeholders,
    concerns,
    copied,
    warningsKey,
    needsAck,
  };
}

export type ApprovedReply = { id: string; to: string; subject: string; body: string };

export function replySubject(subject: string): string {
  if (!subject.trim()) return "Re: your message";
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

export function toCsv(rows: ApprovedReply[]): string {
  // Candidates control the address and subject. A cell starting with = + - @ would run
  // as a formula when the recruiter opens the file in a spreadsheet (Day 4 red-team),
  // so it gets a leading apostrophe, which spreadsheets show as plain text.
  const defuse = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const cell = (raw: string) => {
    const v = defuse(raw);
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return ["id,to,subject,body", ...rows.map((r) => [r.id, r.to, r.subject, r.body].map(cell).join(","))].join("\n") + "\n";
}
