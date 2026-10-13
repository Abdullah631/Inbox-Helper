// Usage:
//   npm run eval                         keyword classifier
//   npm run eval -- --llm                LLM with the active prompt (lib/prompts.ts)
//   npm run eval -- --llm --prompt v1    LLM with a specific prompt version
//
// Each run is saved to evals/results/ and one summary line is appended to
// evals/history.csv, so the daily logs can quote real numbers.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { classifyInbox } from "../lib/classify";
import { evaluate } from "../lib/evaluate";
import { getProvider } from "../lib/llm";
import { ACTIVE_PROMPTS, loadPrompt } from "../lib/prompts";
import { LabeledMessageSchema } from "../lib/schema";

const root = join(__dirname, "..");
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));

const args = process.argv.slice(2);
const useLlm = args.includes("--llm");
const promptArg = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : undefined;

async function main() {
  const dataset = z
    .array(LabeledMessageSchema)
    .parse(JSON.parse(readFileSync(join(root, "data/sample-inbox.json"), "utf8")));
  const messages = dataset.map(({ id, from, subject, body }) => ({ id, from, subject, body }));

  // Messages noted as prompt injection. These must get flagged.
  const injectionIds = dataset.filter((m) => /injection/i.test(m.note ?? "")).map((m) => m.id);

  let deps = {};
  if (useLlm) {
    const provider = getProvider();
    if (!provider) throw new Error("--llm needs GROQ_API_KEY or GEMINI_API_KEY in .env.local");
    deps = { provider, prompt: loadPrompt("classify", promptArg ?? ACTIVE_PROMPTS.classify) };
  }

  const started = Date.now();
  const result = await classifyInbox(messages, useLlm ? "llm" : "keyword", deps);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const report = evaluate(dataset, result.classifications, injectionIds);

  const label = result.method === "llm" ? `llm ${result.model} prompt ${result.promptVersion}` : "keywords";
  const unverified = dataset.filter((m) => m.label_source !== "human").length;
  const fellBack = result.method === "llm" ? result.classifications.filter((c) => c.method === "fallback").length : 0;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log(`\nClassifier: ${label}  (${seconds}s)`);
  console.log(`Accuracy:   ${report.correct}/${report.total} = ${pct(report.accuracy)}`);
  console.log(`Confident mistakes: ${report.confidentMistakes} (wrong, and not flagged for review)`);
  console.log(`Injection:  flagged ${report.injection.flagged}/${report.injection.expected}`);
  if (result.method === "llm") console.log(`Fallbacks:  ${fellBack} messages used keywords because the LLM call failed`);
  for (const w of result.warnings) console.log(`Warning:    ${w}`);
  if (unverified) console.log(`Note: ${unverified}/${dataset.length} labels are still ai-proposed (not human-verified).`);

  console.log(`\n${"intent".padEnd(20)}${"precision".padStart(10)}${"recall".padStart(10)}${"n".padStart(5)}`);
  for (const m of report.perIntent)
    console.log(`${m.intent.padEnd(20)}${pct(m.precision).padStart(10)}${pct(m.recall).padStart(10)}${String(m.support).padStart(5)}`);

  console.log(`\nMistakes (${report.mistakes.length}):`);
  const reasons = new Map(result.classifications.map((c) => [c.id, c.reason]));
  for (const x of report.mistakes) {
    console.log(`  ${x.id}  expected ${x.expected.padEnd(18)} got ${x.predicted.padEnd(18)} conf ${x.confidence}  "${x.body.slice(0, 60)}"`);
    if (result.method === "llm") console.log(`        model said: ${reasons.get(x.id)}`);
  }

  const runAt = new Date().toISOString();
  const outDir = join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  const tag = result.method === "llm" ? `llm-${result.promptVersion}` : "keyword";
  const outFile = join(outDir, `${tag}-${runAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify({ ...result, runAt, seconds: Number(seconds), unverifiedLabels: unverified, report }, null, 2));

  const history = join(root, "evals/history.csv");
  if (!existsSync(history)) writeFileSync(history, "run_at,method,model,prompt,accuracy,correct,total,confident_mistakes,injection_flagged,injection_total,fallbacks,unverified_labels,seconds\n");
  appendFileSync(
    history,
    [runAt, result.method, result.model ?? "", result.promptVersion ?? "", report.accuracy, report.correct, report.total,
      report.confidentMistakes, report.injection.flagged, report.injection.expected, fellBack, unverified, seconds].join(",") + "\n",
  );

  console.log(`\nSaved ${outFile.replace(root + "/", "")} and appended to evals/history.csv`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
