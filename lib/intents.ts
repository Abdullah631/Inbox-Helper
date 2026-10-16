// The fixed set of things a candidate can want. Every message maps to exactly one of
// these. A message that asks two things gets the riskier one (see the classify prompt);
// supporting several groups per message is a known gap.
export const INTENTS = [
  "scheduling",
  "status_check",
  "offer_compensation",
  "withdrawal",
  "documents",
  "referral",
  "question",
  "other",
] as const;

export type Intent = (typeof INTENTS)[number];

export const INTENT_INFO: Record<Intent, { label: string; description: string }> = {
  scheduling: {
    label: "Scheduling",
    description: "Book, confirm, reschedule or cancel an interview slot.",
  },
  status_check: {
    label: "Status check",
    description: "Asking where their application stands or when they'll hear back.",
  },
  offer_compensation: {
    label: "Offer & compensation",
    description: "Salary, offer terms, negotiation, start date of an offer. Always needs a human.",
  },
  withdrawal: {
    label: "Withdrawal",
    description: "Candidate is pulling out of the process.",
  },
  documents: {
    label: "Documents",
    description: "Sending or asking about CV, portfolio, references, ID, certificates.",
  },
  referral: {
    label: "Referral",
    description: "Recommending someone else, or asking about referring.",
  },
  question: {
    label: "Question about role/company",
    description: "Questions about the job, team, remote policy, process, tech stack.",
  },
  other: {
    label: "Other",
    description: "Thank-yous, spam, unclear, or anything that fits nowhere else.",
  },
};

// A person has to handle these themselves, even if a draft looks fine.
export const SENSITIVE_INTENTS: ReadonlySet<Intent> = new Set(["offer_compensation", "withdrawal"]);
