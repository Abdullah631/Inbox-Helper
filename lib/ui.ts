// Labels and colors the UI uses for groups, flags and draft sources. One place, so the
// cards, filter tabs and group headings can't drift apart.
import type { Intent } from "./intents";
import type { Draft, Flag, Mode } from "./schema";

export const INTENT_COLOR: Record<Intent, string> = {
  scheduling: "#3b82f6",
  status_check: "#8b5cf6",
  offer_compensation: "#f59e0b",
  withdrawal: "#ef4444",
  documents: "#14b8a6",
  referral: "#ec4899",
  question: "#22c55e",
  other: "#94a3b8",
};

export const FLAG_UI: Record<Flag, { label: string; tone: string }> = {
  possible_injection: { label: "Possible injection", tone: "badge-danger" },
  needs_human: { label: "Needs a person", tone: "badge-warn" },
  low_confidence: { label: "Low confidence", tone: "badge-warn" },
  intent_disputed: { label: "Group disputed", tone: "badge-warn" },
};

export const SOURCE_LABEL: Record<Draft["source"], string> = { llm: "AI draft", template: "Template", none: "Write your own" };

export const MODE_HELP: Record<Mode, string> = {
  auto: "Use AI if the server has a key, otherwise keywords and templates",
  llm: "AI sorting, drafting and a second AI reviewing the drafts",
  keyword: "Keyword sorting and template replies. No AI calls",
};

export const FORMAT_LABEL = { json: "JSON", csv: "CSV", text: "plain text", empty: "" } as const;
