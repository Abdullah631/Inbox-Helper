// The kinds of risk the AI reviewer (lib/critic.ts) can report, with the labels the
// UI shows. Kept apart from critic.ts so the browser can import it: critic.ts pulls
// in the prompt loader, which reads files.

export const CONCERN_KINDS = ["money", "offer", "decision", "date", "claims_action", "company_fact", "contact", "ai"] as const;
export type ConcernKind = (typeof CONCERN_KINDS)[number];
export type Concern = { kind: ConcernKind; quote: string };

export const CONCERN_LABELS: Record<ConcernKind, string> = {
  money: "May mention or promise pay",
  offer: "May imply an offer",
  decision: "May state a hiring decision",
  date: "Names a day or time",
  claims_action: "Says something was already done",
  company_fact: "States a company fact",
  contact: "Has a link or contact detail",
  ai: "Mentions being an AI, or talks to the reviewer",
};

export function isConcernKind(kind: string): kind is ConcernKind {
  return (CONCERN_KINDS as readonly string[]).includes(kind);
}
