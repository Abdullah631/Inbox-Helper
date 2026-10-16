// Every size, count and threshold the app depends on, in one place.
//
// This file is safe to import from the browser: no env access, no Node APIs.
// Values that operators may want to change per deployment (models, timeouts, rate
// limits, prompt versions) live in lib/server-config.ts instead and come from env.
// Several numbers here depend on each other; tests/limits.test.ts checks that they
// stay consistent.

export const MESSAGE_LIMITS = {
  idMax: 100,
  fromMax: 320, // longest valid email address
  subjectMax: 500,
  bodyMax: 20_000,
} as const;

export const REQUEST_LIMITS = {
  // Per API call. The UI sends chunks of exactly this size, so anything bigger
  // can only come from a script. Kept small so one call can't spend much of the
  // shared token budget or run past the serverless time limit.
  classifyMessagesMax: 20,
  draftItemsMax: 10,
  // Raw request body. 20 messages at the body cap is about 400 KB of JSON.
  bodyBytesMax: 600_000,
} as const;

export const BATCH_SIZES = {
  classify: 10,
  draft: 10,
  // Small on purpose: drafts are written from candidate text, so a draft that tries
  // to talk to the reviewer can only affect the few drafts checked alongside it.
  critic: 5,
} as const;

// How much of each message body the models see, and the keyword rules scan.
export const PROMPT_BODY_CHARS = 2_000;

// Below this a classification gets the low_confidence flag and goes to review.
export const LOW_CONFIDENCE = 0.5;

// Longest draft the guardrails allow, and the most text accepted from a model for one
// draft (anything longer is treated as a broken reply).
export const DRAFT_MAX_WORDS = 120;
export const DRAFT_REPLY_CHARS_MAX = 4_000;

// Attempts per model call when the reply isn't valid JSON (the second one includes
// the error). Applies to classify, draft and critic calls alike.
export const JSON_ATTEMPTS = 2;

export const CLIENT_LIMITS = {
  inboxMessagesMax: 200,
  uploadBytesMax: 2_000_000,
  // How long a saved review session is kept in the browser before it's dropped.
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  sessionSaveDebounceMs: 500,
  parseDebounceMs: 200,
} as const;

export const STORAGE_KEYS = {
  theme: "inbox-helper-theme",
  mode: "inbox-helper-mode",
  recruiter: "inbox-helper-recruiter",
  // Bump the version when the saved shape changes; old sessions are then ignored.
  session: "inbox-helper-session-v2",
} as const;

export const SITE = {
  name: "Inbox Helper",
  tagline: "Sort candidate messages. Review every reply.",
  description: "Groups candidate messages by intent and drafts replies for human review.",
  repoUrl: process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/Abdullah631/Inbox-Helper",
} as const;
