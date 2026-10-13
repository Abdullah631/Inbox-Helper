import { LOW_CONFIDENCE } from "./flags";
import { INTENTS, type Intent } from "./intents";
import type { Classification, LabeledMessage } from "./schema";

export type IntentMetrics = { intent: Intent; precision: number; recall: number; support: number };

export type EvalReport = {
  total: number;
  correct: number;
  accuracy: number;
  perIntent: IntentMetrics[];
  confusion: Record<Intent, Record<Intent, number>>; // confusion[expected][predicted]
  mistakes: { id: string; expected: Intent; predicted: Intent; confidence: number; body: string }[];
  // Wrong answers that would NOT be flagged for review. These are the dangerous ones.
  confidentMistakes: number;
  injection: { expected: number; flagged: number };
};

const round = (n: number) => Number(n.toFixed(3));

export function evaluate(
  dataset: LabeledMessage[],
  predictions: Classification[],
  injectionIds: string[] = [],
): EvalReport {
  const byId = new Map(predictions.map((p) => [p.id, p]));
  const confusion = Object.fromEntries(
    INTENTS.map((e) => [e, Object.fromEntries(INTENTS.map((p) => [p, 0]))]),
  ) as EvalReport["confusion"];

  const mistakes: EvalReport["mistakes"] = [];
  let correct = 0;

  for (const item of dataset) {
    const pred = byId.get(item.id);
    if (!pred) throw new Error(`Missing prediction for ${item.id}`);
    confusion[item.expected_intent][pred.intent]++;
    if (pred.intent === item.expected_intent) correct++;
    else
      mistakes.push({
        id: item.id,
        expected: item.expected_intent,
        predicted: pred.intent,
        confidence: pred.confidence,
        body: item.body,
      });
  }

  const perIntent = INTENTS.map((intent) => {
    const tp = confusion[intent][intent];
    const predicted = INTENTS.reduce((s, e) => s + confusion[e][intent], 0);
    const support = INTENTS.reduce((s, p) => s + confusion[intent][p], 0);
    return {
      intent,
      precision: predicted ? round(tp / predicted) : 0,
      recall: support ? round(tp / support) : 0,
      support,
    };
  });

  const flagged = injectionIds.filter((id) => byId.get(id)?.flags.includes("possible_injection")).length;

  return {
    total: dataset.length,
    correct,
    accuracy: dataset.length ? round(correct / dataset.length) : 0,
    perIntent,
    confusion,
    mistakes,
    confidentMistakes: mistakes.filter((m) => m.confidence >= LOW_CONFIDENCE).length,
    injection: { expected: injectionIds.length, flagged },
  };
}
