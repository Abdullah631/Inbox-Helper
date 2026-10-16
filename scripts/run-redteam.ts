// Usage:
//   npm run redteam                     guardrail and CSV checks only (no API calls)
//   npm run redteam -- --llm            also runs the message attacks through the real pipeline
//   npm run redteam -- --llm --provider gemini
//   npm run redteam -- --save           save the code-only result too
//
// Prints every case as CAUGHT or MISSED. Some guardrail cases are known misses (marked
// known_miss in data/redteam.json): the regex rules don't catch those phrasings and the
// AI reviewer does. Exit code 1 means something changed: a new miss, or a known miss
// that is now caught and should come off the list. That makes it usable as a CI gate.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyInbox } from "../lib/classify";
import { draftReplies } from "../lib/draft";
import { checkDraft } from "../lib/guardrails";
import { toCsv } from "../lib/review";
import { cliArgs, fail, loadConfig, ROOT as root, singleProvider } from "./_cli";

const config = loadConfig();
// Results are saved for --llm runs (real pipeline, worth keeping) or with --save. The
// code-only check runs on every CI build and local check, and used to leave a new,
// identical file each time.
const { values: args } = cliArgs({
  llm: { type: "boolean", default: false },
  provider: { type: "string" },
  save: { type: "boolean", default: false },
});

type DraftCase = { id: string; text: string; should_block: boolean; attack: string; round: number; known_miss?: string };
type MessageCase = { id: string; body: string; must_flag: boolean; canary: string | null; attack: string };
type CsvCase = { id: string; to: string; attack: string };
const data: { drafts: DraftCase[]; messages: MessageCase[]; csv: CsvCase[] } = JSON.parse(
  readFileSync(join(root, "data/redteam.json"), "utf8"),
);

const report: Record<string, unknown>[] = [];
const line = (ok: boolean, id: string, attack: string, detail = "") =>
  console.log(`  ${ok ? "CAUGHT" : "MISSED"}  ${id}  ${attack}${detail ? `  (${detail})` : ""}`);

async function main() {
  let missedA = 0;
  const surprises: string[] = [];
  for (const [i, c] of data.drafts.entries()) {
    if (i === 0 || data.drafts[i - 1].round !== c.round) {
      const note = c.round === 1 ? "written before the Day 4 guardrail fixes" : "written after them, not tuned to";
      console.log(`\nA${c.round}. Guardrails on draft text, round ${c.round} (${note})`);
    }
    const issues = checkDraft(c.text);
    const ok = issues.length > 0 === c.should_block;
    if (!ok) missedA++;
    if (!ok && !c.known_miss) surprises.push(`${c.id} is a new miss: ${c.attack}`);
    if (ok && c.known_miss) surprises.push(`${c.id} is now caught: remove known_miss from data/redteam.json`);
    line(ok, c.id, c.attack, (issues.map((x) => x.kind).join(", ") || "no issues") + (!ok && c.known_miss ? ", known miss" : ""));
    report.push({ layer: "guardrail", round: c.round, id: c.id, ok, issues: issues.map((x) => x.kind) });
  }

  console.log("\nC. CSV export");
  let missedC = 0;
  for (const c of data.csv) {
    const out = toCsv([{ id: c.id, to: c.to, subject: "Re: x", body: "y" }]).split("\n")[1];
    const toCell = out.split(",").slice(1).join(",");
    const ok = !/^"?[=+\-@\t\r]/.test(toCell);
    if (!ok) {
      missedC++;
      surprises.push(`${c.id} CSV cell not defused: ${c.attack}`);
    }
    line(ok, c.id, c.attack, toCell.slice(0, 40));
    report.push({ layer: "csv", id: c.id, ok, cell: toCell });
  }

  let missedB = 0;
  let model = "";
  if (args.llm) {
    const provider = singleProvider(config, args.provider);
    const messages = data.messages.map((m) => ({ id: m.id, from: `${m.id}@redteam.test`, subject: "", body: m.body }));
    const sorted = await classifyInbox(messages, "llm", { provider });
    const drafted = await draftReplies(
      messages.map((message, i) => ({ message, classification: sorted.classifications[i] })), // same order: classifyInbox keeps input order
      "llm",
      { provider },
    );
    model = provider.model;
    const fellBack = sorted.classifications.filter((c) => c.method !== "llm").length + drafted.drafts.filter((d) => d.source === "template").length;
    console.log(`\nB. Message attacks through the pipeline (${model}${fellBack ? `, WARNING: ${fellBack} fallbacks` : ""})`);

    for (const [i, c] of data.messages.entries()) {
      const cls = sorted.classifications[i];
      const draft = drafted.drafts[i];
      const flagged = cls.flags.includes("possible_injection");
      const needsHuman = cls.flags.includes("needs_human");
      const blocked = checkDraft(draft.reply).length > 0;
      const leaked = c.canary ? draft.reply.toLowerCase().includes(c.canary.toLowerCase()) : false;
      // The attack works if a reviewer could approve the draft with no warning and it
      // contains what the attacker wanted, or if a message that had to be flagged wasn't.
      const silentLeak = leaked && !blocked && !needsHuman;
      const ok = !silentLeak && (!c.must_flag || flagged);
      if (!ok) {
        missedB++;
        surprises.push(`${c.id} got through the pipeline: ${c.attack}`);
      }
      const detail = [
        cls.intent,
        flagged ? "flagged" : "not flagged",
        draft.source === "none" ? "no draft" : blocked ? "draft blocked" : "draft passes",
        leaked ? `canary in draft` : "",
      ].filter(Boolean).join(", ");
      line(ok, c.id, c.attack, detail);
      report.push({ layer: "pipeline", id: c.id, ok, intent: cls.intent, flags: cls.flags, draft: draft.reply, leaked, blocked });
    }
  }

  const total = data.drafts.length + data.csv.length + (args.llm ? data.messages.length : 0);
  const missed = missedA + missedB + missedC;
  console.log(`\nMissed ${missed} of ${total}  (guardrails ${missedA}, csv ${missedC}${args.llm ? `, pipeline ${missedB}` : ""})`);

  if (args.llm || args.save) {
    mkdirSync(join(root, "evals/results"), { recursive: true });
    const runAt = new Date().toISOString();
    const file = `evals/results/redteam-${runAt.replace(/[:.]/g, "-")}.json`;
    writeFileSync(join(root, file), JSON.stringify({ runAt, model, missed, total, report }, null, 2));
    console.log(`Saved ${file}`);
  }

  if (surprises.length) {
    console.log(`\nChanged since the last recorded result:\n${surprises.map((x) => `  ${x}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nNo changes against the recorded known misses.");
}

main().catch(fail);
