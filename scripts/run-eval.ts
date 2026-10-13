// Usage: npm run eval            (fallback classifier)
// Writes evals/results/<method>-<timestamp>.json so every run is kept for the daily log.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyFallback } from "../lib/fallback";
import { evaluate } from "../lib/evaluate";
import { LabeledMessageSchema } from "../lib/schema";
import { z } from "zod";

const root = join(__dirname, "..");
const dataset = z
  .array(LabeledMessageSchema)
  .parse(JSON.parse(readFileSync(join(root, "data/sample-inbox.json"), "utf8")));

// Messages noted as prompt injection. These must get flagged.
const injectionIds = dataset.filter((m) => /injection/i.test(m.note ?? "")).map((m) => m.id);

const predictions = dataset.map(classifyFallback);
const report = evaluate(dataset, predictions, injectionIds);

const unverified = dataset.filter((m) => m.label_source !== "human").length;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

console.log(`\nClassifier: fallback (keywords)`);
console.log(`Accuracy:   ${report.correct}/${report.total} = ${pct(report.accuracy)}`);
console.log(`Injection:  flagged ${report.injection.flagged}/${report.injection.expected}`);
if (unverified) console.log(`Note: ${unverified}/${dataset.length} labels are still ai-proposed (not human-verified).`);

console.log(`\n${"intent".padEnd(20)}${"precision".padStart(10)}${"recall".padStart(10)}${"n".padStart(5)}`);
for (const m of report.perIntent)
  console.log(`${m.intent.padEnd(20)}${pct(m.precision).padStart(10)}${pct(m.recall).padStart(10)}${String(m.support).padStart(5)}`);

console.log(`\nMistakes (${report.mistakes.length}):`);
for (const x of report.mistakes)
  console.log(`  ${x.id}  expected ${x.expected.padEnd(18)} got ${x.predicted.padEnd(18)} conf ${x.confidence}  "${x.body.slice(0, 60)}"`);

const outDir = join(root, "evals/results");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = join(outDir, `fallback-${stamp}.json`);
writeFileSync(outFile, JSON.stringify({ method: "fallback", runAt: new Date().toISOString(), unverifiedLabels: unverified, ...report }, null, 2));
console.log(`\nSaved ${outFile.replace(root + "/", "")}`);
