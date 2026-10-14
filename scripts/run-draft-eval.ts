// Usage:
//   npm run eval:drafts                                   classify live, then draft
//   npm run eval:drafts -- --from evals/results/<run>.json   reuse a saved classification run
//   npm run eval:drafts -- --prompt v1                    pick the draft prompt version
//
// Reusing a saved run keeps the classifier's mistakes fixed, so the dispute numbers
// can be compared fairly across draft prompts.
//
// Writes evals/results/drafts-<version>-<time>.json, a readable drafts-latest.md for
// a person to go through, and one line in evals/drafts-history.csv.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { classifyInbox } from "../lib/classify";
import { draftReplies } from "../lib/draft";
import { LOW_CONFIDENCE } from "../lib/flags";
import { checkDraft, wordCount, type IssueKind } from "../lib/guardrails";
import { getProvider } from "../lib/llm";
import { ACTIVE_PROMPTS, loadPrompt } from "../lib/prompts";
import { ClassificationSchema, LabeledMessageSchema, type Classification } from "../lib/schema";

const root = join(__dirname, "..");
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dataFile = arg("--data") ?? "data/sample-inbox.json";

async function main() {
  // One provider per run so the score belongs to one model. --provider gemini to switch.
    const provider = getProvider(process.env, { failover: false, only: arg("--provider") as "groq" | "gemini" | undefined });
  if (!provider) throw new Error("Needs GROQ_API_KEY or GEMINI_API_KEY in .env.local");

  const dataset = z.array(LabeledMessageSchema).parse(JSON.parse(readFileSync(join(root, dataFile), "utf8")));
  const messages = dataset.map(({ id, from, subject, body }) => ({ id, from, subject, body }));
  const expected = new Map(dataset.map((d) => [d.id, d.expected_intent]));

  let classifications: Classification[];
  let classifiedBy: string;
  const from = arg("--from");
  if (from) {
    const saved = JSON.parse(readFileSync(join(root, from), "utf8"));
    classifications = z.array(ClassificationSchema).parse(saved.classifications);
    classifiedBy = `${from}`;
  } else {
    const r = await classifyInbox(messages, "llm", { provider });
    classifications = r.classifications;
    classifiedBy = `live, ${r.model} prompt ${r.promptVersion}`;
  }

  const prompt = loadPrompt("draft", arg("--prompt") ?? ACTIVE_PROMPTS.draft);
  const started = Date.now();
  const items = messages.map((message, i) => ({ message, classification: classifications[i] }));
  // critic: null keeps this eval about drafting alone (the reviewer has its own eval).
  const result = await draftReplies(items, "llm", { provider, prompt, critic: null });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  // Guardrails on model-written drafts only. Templates are tested separately.
  const llmDrafts = result.drafts.filter((d) => d.source === "llm");
  const issueCounts: Partial<Record<IssueKind, number>> = {};
  const blocked: { id: string; kinds: string[]; reply: string }[] = [];
  for (const d of llmDrafts) {
    const issues = checkDraft(d.reply);
    for (const i of issues) issueCounts[i.kind] = (issueCounts[i.kind] ?? 0) + 1;
    if (issues.length) blocked.push({ id: d.id, kinds: issues.map((i) => `${i.kind} ("${i.match ?? ""}")`), reply: d.reply });
  }
  const words = llmDrafts.map((d) => wordCount(d.reply));

  // Disputes vs. the classifier's actual mistakes.
  const byId = new Map(classifications.map((c) => [c.id, c]));
  const confidentMistakes = classifications.filter((c) => c.intent !== expected.get(c.id) && c.confidence >= LOW_CONFIDENCE);
  const disputes = result.drafts.filter((d) => d.dispute);
  const caught = confidentMistakes.filter((c) => result.drafts.find((d) => d.id === c.id)?.dispute);
  const caughtRight = caught.filter((c) => result.drafts.find((d) => d.id === c.id)?.dispute?.suggested === expected.get(c.id));
  const falseDisputes = disputes.filter((d) => byId.get(d.id)!.intent === expected.get(d.id));

  const fellBack = result.drafts.filter((d) => d.source === "template").length;

  console.log(`\nDrafts: ${result.model} draft prompt ${result.promptVersion}  (${seconds}s)`);
  console.log(`Classification: ${classifiedBy}`);
  console.log(`LLM drafts: ${llmDrafts.length}, template fallbacks: ${fellBack}, injection (no draft): ${result.drafts.filter((d) => d.source === "none").length}`);
  for (const w of result.warnings) console.log(`Warning: ${w}`);
  console.log(`\nGuardrails: ${blocked.length} of ${llmDrafts.length} drafts blocked`, issueCounts);
  console.log(`Words per draft: min ${Math.min(...words)}, max ${Math.max(...words)}, mean ${(words.reduce((a, b) => a + b, 0) / words.length).toFixed(0)}`);
  console.log(`\nConfident mistakes from the classifier: ${confidentMistakes.length}`);
  console.log(`  disputed by the drafting step: ${caught.length} (with the right group suggested: ${caughtRight.length})`);
  console.log(`Disputes on messages the classifier got right: ${falseDisputes.length}`);
  for (const d of disputes) {
    const c = byId.get(d.id)!;
    console.log(`  ${d.id}  grouped ${c.intent.padEnd(18)} model suggests ${d.dispute!.suggested.padEnd(18)} label ${expected.get(d.id)}`);
  }
  for (const b of blocked) console.log(`\nBlocked ${b.id}: ${b.kinds.join(", ")}\n  ${b.reply}`);

  // Readable dump for a person to judge tone and usefulness, which no check can do.
  const md = [
    `# Drafts: ${result.model}, draft prompt ${result.promptVersion}`,
    "",
    `Run at ${new Date().toISOString()}. Classification: ${classifiedBy}.`,
    "",
    ...result.drafts.map((d) => {
      const m = messages.find((x) => x.id === d.id)!;
      const c = byId.get(d.id)!;
      const issues = checkDraft(d.reply).map((i) => i.kind);
      return [
        `## ${d.id} (${c.intent}${d.dispute ? `, disputed: ${d.dispute.suggested}` : ""})`,
        "",
        `> ${m.body}`,
        "",
        d.source === "none" ? "_No draft: flagged as possible injection._" : d.reply,
        "",
        `Source: ${d.source}. ${issues.length ? `Guardrails: ${issues.join(", ")}.` : "Guardrails: ok."}`,
        "",
      ].join("\n");
    }),
  ].join("\n");

  const runAt = new Date().toISOString();
  const outDir = join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `drafts-${result.promptVersion}-${runAt.replace(/[:.]/g, "-")}.json`),
    JSON.stringify({ runAt, classifiedBy, seconds: Number(seconds), ...result, issueCounts, blocked }, null, 2));
  writeFileSync(join(outDir, "drafts-latest.md"), md);

  if (fellBack > 0) {
    console.log(`\nINVALID RUN: ${fellBack} drafts fell back to templates. Not added to history.`);
    process.exit(1);
  }
  const history = join(root, "evals/drafts-history.csv");
  if (!existsSync(history)) writeFileSync(history, "run_at,model,draft_prompt,classified_by,llm_drafts,blocked,confident_mistakes,caught,caught_right_group,false_disputes,fallbacks,seconds\n");
  appendFileSync(history, [runAt, result.model, result.promptVersion, `"${classifiedBy}"`, llmDrafts.length, blocked.length,
    confidentMistakes.length, caught.length, caughtRight.length, falseDisputes.length, fellBack, seconds].join(",") + "\n");

  console.log(`\nSaved results, evals/results/drafts-latest.md and a line in evals/drafts-history.csv`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
