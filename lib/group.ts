import { INTENTS, type Intent } from "./intents";
import type { Classification, Message } from "./schema";

export type GroupedItem = { message: Message; classification: Classification };
export type Group = { intent: Intent; items: GroupedItem[] };

// Groups in INTENTS order; within a group, flagged and least-confident items come
// first so the reviewer sees the risky ones before the easy ones.
export function groupByIntent(messages: Message[], classifications: Classification[]): Group[] {
  const byId = new Map(classifications.map((c) => [c.id, c]));

  const groups = new Map<Intent, GroupedItem[]>();
  for (const message of messages) {
    const classification = byId.get(message.id);
    if (!classification) throw new Error(`No classification for message ${message.id}`);
    const list = groups.get(classification.intent) ?? [];
    list.push({ message, classification });
    groups.set(classification.intent, list);
  }

  return INTENTS.filter((i) => groups.has(i)).map((intent) => ({
    intent,
    items: groups.get(intent)!.sort(
      (a, b) =>
        b.classification.flags.length - a.classification.flags.length ||
        a.classification.confidence - b.classification.confidence,
    ),
  }));
}
