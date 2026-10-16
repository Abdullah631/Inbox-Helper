// All review state and every way it can change, as a pure reducer. The page used to
// hold this in six useState hooks updated from async code, which caused races the Day 5
// review found (a group moved by hand being overwritten by a draft that arrived later).
// Pure, so every transition has a unit test.
import { computeFlags } from "./flags";
import { INTENT_INFO, type Intent } from "./intents";
import { fillKnownPlaceholders, type ReviewStatus } from "./review";
import type { Classification, Draft, Message } from "./schema";
import { TEMPLATES } from "./templates";

// acknowledged: the warningsKey (lib/review.ts) the reviewer ticked, or null.
export type ReviewState = { draft: Draft; text: string; original: string; status: ReviewStatus; acknowledged: string | null };

export type RunInfo = { method: "llm" | "keyword"; model?: string; promptVersion?: string; seconds: number; reviewer?: string };

export type State = {
  messages: Message[];
  classes: Record<string, Classification>;
  reviews: Record<string, ReviewState>;
  run: RunInfo | null;
  recruiter: string;
};

export type Action =
  | { type: "reset" }
  | { type: "restore"; state: Omit<State, "recruiter"> }
  | { type: "start"; messages: Message[] }
  | { type: "classified"; classifications: Classification[] }
  | { type: "sorted"; run: RunInfo }
  // Messages the run couldn't sort are dropped, so every remaining one has a group.
  | { type: "dropUnsorted" }
  // sentIntents: the group each message had when its draft was requested.
  | { type: "drafted"; drafts: Draft[]; sentIntents: Record<string, Intent>; reviewer?: string }
  | { type: "useTemplates"; ids: string[] }
  | { type: "edit"; id: string; text: string }
  | { type: "status"; id: string; status: ReviewStatus }
  | { type: "acknowledge"; id: string; value: string | null }
  | { type: "resetDraft"; id: string }
  | { type: "move"; id: string; intent: Intent }
  | { type: "keepGroup"; id: string }
  | { type: "setRecruiter"; name: string }
  | { type: "sign" };

export const initialState: State = { messages: [], classes: {}, reviews: {}, run: null, recruiter: "" };

function review(draft: Draft, message: Message, recruiter: string): ReviewState {
  const text = fillKnownPlaceholders(draft.reply, message, recruiter);
  return { draft, text, original: text, status: "pending", acknowledged: null };
}

function templateFor(message: Message, intent: Intent): Draft {
  return { id: message.id, reply: TEMPLATES[intent], source: "template", dispute: null, concerns: null };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { ...initialState, recruiter: state.recruiter };

    case "restore":
      return { ...action.state, recruiter: state.recruiter };

    case "start":
      return { ...initialState, recruiter: state.recruiter, messages: action.messages };

    case "classified": {
      const known = new Set(state.messages.map((m) => m.id));
      const classes = { ...state.classes };
      for (const c of action.classifications) if (known.has(c.id)) classes[c.id] = c;
      return { ...state, classes };
    }

    case "sorted":
      return { ...state, run: action.run };

    case "dropUnsorted":
      return { ...state, messages: state.messages.filter((m) => state.classes[m.id]) };

    case "drafted": {
      const byId = new Map(state.messages.map((m) => [m.id, m]));
      const reviews = { ...state.reviews };
      const classes = { ...state.classes };
      for (const draft of action.drafts) {
        const message = byId.get(draft.id);
        const current = classes[draft.id];
        if (!message || !current) continue;
        // The person moved this message while its draft was being written. Their group
        // wins: the AI draft was written for the old group, so use the new group's template.
        if (action.sentIntents[draft.id] !== undefined && action.sentIntents[draft.id] !== current.intent) {
          if (draft.source !== "none") reviews[draft.id] = review(templateFor(message, current.intent), message, state.recruiter);
          else reviews[draft.id] = review(draft, message, state.recruiter);
          continue;
        }
        reviews[draft.id] = review(draft, message, state.recruiter);
        if (draft.dispute && !current.flags.includes("intent_disputed")) {
          classes[draft.id] = { ...current, flags: [...current.flags, "intent_disputed"] };
        }
      }
      const run = state.run && action.reviewer ? { ...state.run, reviewer: joinModels(state.run.reviewer, action.reviewer) } : state.run;
      return { ...state, reviews, classes, run };
    }

    case "useTemplates": {
      const reviews = { ...state.reviews };
      for (const id of action.ids) {
        const message = state.messages.find((m) => m.id === id);
        const c = state.classes[id];
        if (!message || !c || reviews[id]) continue;
        const draft = c.flags.includes("possible_injection")
          ? { id, reply: "", source: "none" as const, dispute: null, concerns: null }
          : templateFor(message, c.intent);
        reviews[id] = review(draft, message, state.recruiter);
      }
      return { ...state, reviews };
    }

    case "edit":
      return updateReview(state, action.id, (r) => (r.status === "pending" ? { ...r, text: action.text } : r));

    case "status":
      return updateReview(state, action.id, (r) => ({ ...r, status: action.status }));

    case "acknowledge":
      return updateReview(state, action.id, (r) => ({ ...r, acknowledged: action.value }));

    case "resetDraft":
      return updateReview(state, action.id, (r) => ({ ...r, text: r.original }));

    case "move": {
      const old = state.classes[action.id];
      const message = state.messages.find((m) => m.id === action.id);
      if (!old || !message || old.intent === action.intent) return state;
      // A person decided, so confidence is treated as certain. The injection flag stays.
      const injection = old.flags.includes("possible_injection");
      const moved: Classification = {
        ...old,
        intent: action.intent,
        confidence: 1,
        flags: computeFlags(message, action.intent, 1, injection),
        reason: `Moved by you from ${INTENT_INFO[old.intent].label}.`,
      };
      const r = state.reviews[action.id];
      const reviews = { ...state.reviews };
      if (r && r.draft.source === "template" && r.status === "pending") {
        reviews[action.id] = review(templateFor(message, action.intent), message, state.recruiter);
      }
      return { ...state, classes: { ...state.classes, [action.id]: moved }, reviews };
    }

    case "keepGroup": {
      const c = state.classes[action.id];
      if (!c) return state;
      return { ...state, classes: { ...state.classes, [action.id]: { ...c, flags: c.flags.filter((f) => f !== "intent_disputed") } } };
    }

    case "setRecruiter":
      return { ...state, recruiter: action.name };

    case "sign": {
      const name = state.recruiter.trim();
      if (!name) return state;
      const reviews: Record<string, ReviewState> = {};
      for (const [id, r] of Object.entries(state.reviews)) {
        reviews[id] =
          r.status === "pending"
            ? { ...r, text: r.text.replaceAll("[RECRUITER_NAME]", name), original: r.original.replaceAll("[RECRUITER_NAME]", name) }
            : r;
      }
      return { ...state, reviews };
    }
  }
}

// "a + b" strings from several requests, merged without repeats.
function joinModels(...lists: (string | undefined)[]): string {
  return [...new Set(lists.flatMap((l) => l?.split(" + ") ?? []))].join(" + ");
}

function updateReview(state: State, id: string, fn: (r: ReviewState) => ReviewState): State {
  const r = state.reviews[id];
  if (!r) return state;
  return { ...state, reviews: { ...state.reviews, [id]: fn(r) } };
}
