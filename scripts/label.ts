// Usage: npm run label -- data/holdout.json        (only labels not yet checked)
//        npm run label -- data/holdout.json --all  (go through every label again)
//
// Shows one message at a time with the current label. Press Enter to keep it,
// a number to change it, s to skip, q to quit. Every answer is saved right away
// and marks the label as "human".
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { INTENTS, INTENT_INFO } from "../lib/intents";
import type { LabeledMessage } from "../lib/schema";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run label -- data/holdout.json [--all]");
  process.exit(1);
}
const all = process.argv.includes("--all");
const data: LabeledMessage[] = JSON.parse(readFileSync(file, "utf8"));
// One message per line, same as the original files, so a git diff shows exactly
// which labels changed instead of reformatting the whole file.
const line = (m: LabeledMessage) =>
  `  { ${Object.entries(m).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
const save = () => writeFileSync(file, `[\n${data.map(line).join(",\n")}\n]\n`);

async function main() {
  // Read lines through an iterator rather than rl.question: with piped input,
  // question() missed lines that arrived before it was listening.
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string) => {
    process.stdout.write(prompt);
    const next = await lines.next();
    return next.done ? "q" : next.value;
  };
  const todo = data.filter((m) => all || m.label_source !== "human");
  let changed = 0;
  let kept = 0;

  console.log(`\n${todo.length} of ${data.length} messages to check in ${file}\n`);
  INTENTS.forEach((intent, i) => console.log(`  ${i + 1}  ${intent.padEnd(19)} ${INTENT_INFO[intent].description}`));

  for (const [n, m] of todo.entries()) {
    console.log(`\n${"-".repeat(70)}\n[${n + 1}/${todo.length}] ${m.id}   from ${m.from}${m.subject ? `   subject: ${m.subject}` : ""}\n`);
    console.log(m.body.split("\n").map((l) => `    ${l}`).join("\n"));
    if (m.note) console.log(`\n  note: ${m.note}`);
    const current = INTENTS.indexOf(m.expected_intent) + 1;
    const answer = (await ask(`\n  label: ${current} ${m.expected_intent}   [Enter keep, 1-8 change, s skip, q quit] `)).trim().toLowerCase();

    if (answer === "q") break;
    if (answer === "s") continue;
    if (answer === "") {
      kept++;
    } else {
      const pick = Number(answer);
      if (!Number.isInteger(pick) || pick < 1 || pick > INTENTS.length) {
        console.log("  Not a valid choice, skipped.");
        continue;
      }
      if (INTENTS[pick - 1] !== m.expected_intent) {
        console.log(`  changed ${m.expected_intent} -> ${INTENTS[pick - 1]}`);
        m.expected_intent = INTENTS[pick - 1];
        changed++;
      } else kept++;
    }
    m.label_source = "human";
    save();
  }

  rl.close();
  const left = data.filter((m) => m.label_source !== "human").length;
  console.log(`\nDone for now: ${kept} kept, ${changed} changed. ${left} of ${data.length} still not checked.`);
}

main();
