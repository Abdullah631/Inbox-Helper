import { SENSITIVE_INTENTS, type Intent } from "./intents";
import { LOW_CONFIDENCE } from "./limits";
import type { Flag, Message } from "./schema";
import { skeleton } from "./text";

export { LOW_CONFIDENCE };

// Phrases that try to steer the AI rather than talk to a recruiter. Matched on
// skeleton text, so "Ignоre previous instructions" with a Cyrillic о still counts
// (on Day 4 only the model caught that one).
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /\b(system prompt|you are now|act as|developer mode|new instructions)\b/i,
  /\b(as an ai|dear (ai|assistant|chatbot|llm|bot|model))\b/i,
  /^\s*(system|assistant)\s*:/im,
  /\b(note|message|instructions?) (to|for) (the |any )?(ai|assistant|model|classifier|reviewer|bot)\b/i,
  // Added Day 5 after r02 got past both Groq's model and these patterns. Each one is a
  // kind of message, not a phrase from r02, and none of them flags any of the 90 real
  // messages in data/ (tests/flags.test.ts checks that).
  // Talking to whoever or whatever handles the inbox, instead of to the recruiter.
  // Only when the target is this message or the replies: "forward this to whoever
  // handles referrals" is a normal request and must not match.
  /\b(whoever|whatever|whomever|anyone|anybody)\b[^\n]{0,20}\b(drafts?|writes?|reads?|answers?|sorts?)\b[^\n]{0,15}\b(this|these|replies|messages|emails|inbox|here)\b/i,
  // Addressing a tool directly: "to the assistant sorting this inbox", "to any AI reading this".
  /\b(to|for|dear|hey|attention)\s+(the\s+|any\s+|all\s+)?(ai|a\.i\.|assistant|chatbot|bot|llm|model|system|tool|automation)s?\s+(reading|sorting|drafting|writing|answering|processing|handling|that (reads|sorts|drafts|writes|answers)|here\b)/i,
  // Asking for specific text inside the reply: a code, word or phrase, or a fixed opening.
  /\b(include|add|insert|put|append|mention|use|reply with|respond with)\b[^\n]{0,40}\b(code|phrase|word|token|string|number|line)\b[^\n]{0,60}\b(your|the)\s+(reply|answer|response|email)\b/i,
  /\b(reply|respond|answer)\s+with\s+the\s+(word|phrase|code)\b/i,
  /\b(start|begin|end|open|close|sign off)\s+(your|the)\s+(reply|answer|response|email)\s+with\b/i,
];

export function looksLikeInjectionText(text: string): boolean {
  const s = skeleton(text);
  return INJECTION_PATTERNS.some((p) => p.test(s));
}

export function looksLikeInjection(msg: Pick<Message, "subject" | "body">): boolean {
  return looksLikeInjectionText(`${msg.subject}\n${msg.body}`);
}

// Flags are decided in code, not by the model, so a message can't talk its way out
// of human review. The model can only add an injection flag, never remove one.
// `keywordIntent` is the keyword classifier's answer for the same message: if either
// one thinks it's about salary or a withdrawal, a person reviews it. On Day 5 the
// review showed one message in a batch could nudge the model into filing another
// message's salary question as "other", which would have dropped needs_human.
export function computeFlags(
  msg: Pick<Message, "subject" | "body">,
  intent: Intent,
  confidence: number,
  modelSaysInjection = false,
  keywordIntent?: Intent,
): Flag[] {
  const flags: Flag[] = [];
  if (modelSaysInjection || looksLikeInjection(msg)) flags.push("possible_injection");
  const sensitive = SENSITIVE_INTENTS.has(intent) || (keywordIntent !== undefined && SENSITIVE_INTENTS.has(keywordIntent));
  if (sensitive || flags.includes("possible_injection")) flags.push("needs_human");
  if (confidence < LOW_CONFIDENCE) flags.push("low_confidence");
  return flags;
}
