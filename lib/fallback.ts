import { computeFlags, LOW_CONFIDENCE } from "./flags";
import type { Intent } from "./intents";
import type { Classification, Message } from "./schema";

// Keyword baseline. Deliberately dumb: it exists so the app works with no API
// key, tests are deterministic, and the LLM has a number to beat.
type Rule = { pattern: RegExp; weight: number };

const RULES: Record<Exclude<Intent, "other">, Rule[]> = {
  scheduling: [
    { pattern: /\breschedul\w*/i, weight: 3 },
    { pattern: /\b(interview|call)\b.*\b(slot|time|tomorrow|monday|tuesday|wednesday|thursday|friday|next week)\b/i, weight: 2 },
    { pattern: /\b(availability|available|calendar|time ?slot|timezone|time zone)\b/i, weight: 2 },
    { pattern: /\b(confirm(ing)?|move|postpone|cancel)\b.*\b(interview|call|meeting)\b/i, weight: 2 },
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
    { pattern: /\b(friend|colleague|former teammate|someone i know)\b.*\b(apply|role|position|fit)\b/i, weight: 2 },
    { pattern: /\brecommend (a|my|someone)\b/i, weight: 2 },
  ],
  question: [
    { pattern: /\b(remote|hybrid|on.?site|relocat\w*|visa|sponsorship|tech stack|team size|working hours)\b/i, weight: 2 },
    { pattern: /\b(what does|how many|is the role|is it possible|could you (tell|explain|clarify)|curious about)\b/i, weight: 2 },
    { pattern: /\?/, weight: 1 },
  ],
};

export { LOW_CONFIDENCE };

export function classifyFallback(msg: Message): Classification {
  const text = `${msg.subject}\n${msg.body}`;

  const scores = (Object.keys(RULES) as Exclude<Intent, "other">[]).map((intent) => {
    const score = RULES[intent].reduce((sum, r) => sum + (r.pattern.test(text) ? r.weight : 0), 0);
    return { intent, score };
  });
  scores.sort((a, b) => b.score - a.score);

  const total = scores.reduce((s, x) => s + x.score, 0);
  const top = scores[0];

  let intent: Intent = "other";
  let confidence = 0.3;
  let reason = "No keyword rules matched.";

  if (top.score > 0) {
    intent = top.intent;
    // Share of total signal, damped when the absolute signal is weak.
    const share = top.score / total;
    const strength = Math.min(top.score / 4, 1);
    confidence = Number((share * strength).toFixed(2));
    const runnerUp = scores[1].score > 0 ? `; runner-up ${scores[1].intent} (${scores[1].score})` : "";
    reason = `Keyword score ${top.score} for ${top.intent}${runnerUp}.`;
  }

  const flags = computeFlags(msg, intent, confidence);
  return { id: msg.id, intent, confidence, flags, reason, method: "fallback" };
}
