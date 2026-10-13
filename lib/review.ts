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

export type ApprovalCheck = { canApprove: boolean; issues: Issue[]; placeholders: string[] };

// A draft can be approved only when it passes every guardrail and has no
// placeholders left. Both are re-checked on every edit.
export function approvalCheck(text: string): ApprovalCheck {
  const issues = checkDraft(text);
  const placeholders = placeholdersIn(text);
  return { canApprove: issues.length === 0 && placeholders.length === 0, issues, placeholders };
}

export type ApprovedReply = { id: string; to: string; subject: string; body: string };

export function replySubject(subject: string): string {
  if (!subject.trim()) return "Re: your message";
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

export function toCsv(rows: ApprovedReply[]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["id,to,subject,body", ...rows.map((r) => [r.id, r.to, r.subject, r.body].map(cell).join(","))].join("\n") + "\n";
}
