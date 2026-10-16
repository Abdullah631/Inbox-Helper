import { computeFlags } from "./flags";
import type { Intent } from "./intents";
import { PROMPT_BODY_CHARS } from "./limits";
import type { Classification, Message } from "./schema";

// Keyword baseline. Deliberately dumb: it exists so the app works with no API
// key, tests are deterministic, and the LLM has a number to beat.
type Rule = { pattern: RegExp; weight: number };

// "Near" means within the same line and at most 200 characters apart. The old
// unbounded ".*" scanned the rest of the text for every match, which took 3 seconds
// on 50 long hostile messages (Day 5 security review).
const NEAR = "[^\\n]{0,200}";
const near = (a: string, b: string) => new RegExp(`\\b(${a})\\b${NEAR}\\b(${b})\\b`, "i");

const RULES: Record<Exclude<Intent, "other">, Rule[]> = {
  scheduling: [
    { pattern: /\breschedul\w*/i, weight: 3 },
    { pattern: near("interview|call", "slot|time|tomorrow|monday|tuesday|wednesday|thursday|friday|next week"), weight: 2 },
    { pattern: /\b(availability|available|calendar|time ?slot|timezone|time zone)\b/i, weight: 2 },
    { pattern: near("confirm(?:ing)?|move|postpone|cancel", "interview|call|meeting"), weight: 2 },
    { pattern: /\b(\d{1,2}(:\d{2})?\s?(am|pm)|gmt|utc|pst|cet)\b/i, weight: 1 },
  ],
  status_check: [
    { pattern: /\b(any update|update on|status of|following up|follow up|follow-up|checking in)\b/i, weight: 3 },
    { pattern: /\b(heard back|hear back|next steps?|still (open|considering))\b/i, weight: 2 },
    { pattern: /\bwhere (things|my application) stand/i, weight: 3 },
  ],
  offer_compensation: [
    { pattern: /\b(salary|compensation|pay range|ctc|package|equity|stock options|bonus)\b/i, weight: 3 },
    { pattern: /\b(offer|counter.?offer|negotiat\w*)\b/i, weight: 2 },
    { pattern: /\b(usd|eur|\$|€|£|k per (year|month)|per annum)\b/i, weight: 1 },
  ],
  withdrawal: [
    { pattern: /\bwithdraw\w*\b/i, weight: 4 },
    { pattern: /\b(accepted (an|another) (offer|position|role)|no longer (interested|available|looking))\b/i, weight: 4 },
    { pattern: /\b(pull out|step back from|decided not to (continue|proceed))\b/i, weight: 3 },
  ],
  documents: [
    { pattern: /\b(cv|resume|résumé|portfolio|cover letter|transcript|certificate|references?|passport|id card)\b/i, weight: 2 },
    { pattern: /\b(attach(ed|ing)?|updated version|please find|sending (you|over))\b/i, weight: 2 },
  ],
  referral: [
    { pattern: /\brefer(ral|ring|red)?\b/i, weight: 3 },
    { pattern: near("friend|colleague|former teammate|someone i know", "apply|role|position|fit"), weight: 2 },
    { pattern: /\brecommend (a|my|someone)\b/i, weight: 2 },
  ],
  question: [
    { pattern: /\b(remote|hybrid|on.?site|relocat\w*|visa|sponsorship|tech stack|team size|working hours)\b/i, weight: 2 },
    { pattern: /\b(what does|how many|is the role|is it possible|could you (tell|explain|clarify)|curious about)\b/i, weight: 2 },
    { pattern: /\?/, weight: 1 },
  ],
};

export function keywordIntent(msg: Pick<Message, "subject" | "body">): { intent: Intent; confidence: number; reason: string } {
  // Same slice the models see. Also keeps the cost of a 20,000-character message flat.
  const text = `${msg.subject}\n${msg.body.slice(0, PROMPT_BODY_CHARS)}`;

  const scores = (Object.keys(RULES) as Exclude<Intent, "other">[]).map((intent) => {
    const score = RULES[intent].reduce((sum, r) => sum + (r.pattern.test(text) ? r.weight : 0), 0);
    return { intent, score };
  });
  scores.sort((a, b) => b.score - a.score);

  const total = scores.reduce((s, x) => s + x.score, 0);
  const [top, second] = scores;
  if (top.score === 0) return { intent: "other", confidence: 0.3, reason: "No keyword rules matched." };

  // Share of total signal, damped when the absolute signal is weak.
  const confidence = Number(((top.score / total) * Math.min(top.score / 4, 1)).toFixed(2));
  const runnerUp = second.score > 0 ? `; runner-up ${second.intent} (${second.score})` : "";
  return { intent: top.intent, confidence, reason: `Keyword score ${top.score} for ${top.intent}${runnerUp}.` };
}

export function classifyFallback(msg: Message): Classification {
  const { intent, confidence, reason } = keywordIntent(msg);
  return { id: msg.id, intent, confidence, flags: computeFlags(msg, intent, confidence), reason, method: "fallback" };
}
