import { SENSITIVE_INTENTS, type Intent } from "./intents";
import type { Flag, Message } from "./schema";

export const LOW_CONFIDENCE = 0.5;

// Phrases that try to steer the AI rather than talk to a recruiter.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/i,
  /\b(system prompt|you are now|act as|developer mode)\b/i,
  /\b(as an ai|dear (ai|assistant|chatbot|llm))\b/i,
];

export function looksLikeInjection(msg: Message): boolean {
  const text = `${msg.subject}\n${msg.body}`;
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

// Flags are decided in code, not by the model, so a message can't talk its way
// out of human review. `modelSaysInjection` can only add a flag, never remove one.
export function computeFlags(msg: Message, intent: Intent, confidence: number, modelSaysInjection = false): Flag[] {
  const flags: Flag[] = [];
  if (modelSaysInjection || looksLikeInjection(msg)) flags.push("possible_injection");
  if (SENSITIVE_INTENTS.has(intent) || flags.includes("possible_injection")) flags.push("needs_human");
  if (confidence < LOW_CONFIDENCE) flags.push("low_confidence");
  return flags;
}
