// Usage: npm run eval:critic [-- --provider gemini|groq] [--prompt v1] [--drafts <file>]
// Measures the AI reviewer two ways:
//   1. red-team drafts (both rounds): caught by regex, by the reviewer, by either
//   2. 58 real drafts from a saved run: how many get concerns (false alarm rate),
//      printed so a person can judge each one
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { criticize, type Concern } from "../lib/critic";
import { checkDraft } from "../lib/guardrails";
import { activeVersion, loadPrompt } from "../lib/prompts";
import { cliArgs, fail, loadConfig, ROOT as root, singleProvider } from "./_cli";

const config = loadConfig();
const { values: args } = cliArgs({
  // Defaults to the version the app uses. It used to default to v1 while the app ran v2.
  prompt: { type: "string" },
  // --drafts <file> picks which saved draft run to check for false alarms.
  drafts: { type: "string" },
  // Pick the model that did NOT write the drafts (the saved drafts came from Groq).
  provider: { type: "string", default: "gemini" },
});

async function main() {
  // One provider, no failover, so the score belongs to one model.
  const provider = singleProvider(config, args.provider);
  const prompt = loadPrompt("critic", args.prompt ?? activeVersion("critic", config));
  console.log(`Reviewer model: ${provider.model}, critic prompt ${prompt.version}\n`);

  const red = JSON.parse(readFileSync(join(root, "data/redteam.json"), "utf8")).drafts as
    { id: string; text: string; should_block: boolean; attack: string; round: number }[];
  const redReview = await criticize(red.map((d) => ({ id: d.id, reply: d.text })), provider, prompt);
  if (redReview.warnings.length) throw new Error(`Invalid run, some batches weren't reviewed: ${redReview.warnings.join(" ")}`);
  const concerns = redReview.concerns as Map<string, Concern[]>;

  for (const round of [1, 2]) {
    const cases = red.filter((d) => d.round === round);
    const attacks = cases.filter((d) => d.should_block);
    const controls = cases.filter((d) => !d.should_block);
    const byRegex = attacks.filter((d) => checkDraft(d.text).length > 0);
    const byCritic = attacks.filter((d) => concerns.get(d.id)!.length > 0);
    const byEither = attacks.filter((d) => checkDraft(d.text).length > 0 || concerns.get(d.id)!.length > 0);
    const falseAlarms = controls.filter((d) => concerns.get(d.id)!.length > 0);
    console.log(`Round ${round}: ${attacks.length} attacks. Regex ${byRegex.length}, reviewer ${byCritic.length}, either ${byEither.length}. Reviewer flagged ${falseAlarms.length} of ${controls.length} safe controls.`);
    for (const d of attacks.filter((x) => !byEither.includes(x))) console.log(`   still missed: ${d.id} ${d.attack}`);
    for (const d of falseAlarms) console.log(`   false alarm: ${d.id} ${JSON.stringify(concerns.get(d.id))}`);
  }

  const file = args.drafts ?? readdirSync(join(root, "evals/results")).filter((f) => /^drafts-v2-.*\.json$/.test(f)).sort().at(-1)!;
  const real = (JSON.parse(readFileSync(join(root, "evals/results", file.replace(/^evals\/results\//, "")), "utf8")).drafts as { id: string; reply: string; source: string }[])
    .filter((d) => d.source === "llm");
  const realReview = await criticize(real.map((d) => ({ id: d.id, reply: d.reply })), provider, prompt);
  if (realReview.warnings.length) throw new Error(`Invalid run, some batches weren't reviewed: ${realReview.warnings.join(" ")}`);
  const realConcerns = realReview.concerns as Map<string, Concern[]>;
  const flagged = real.filter((d) => realConcerns.get(d.id)!.length > 0);
  const regexFlagged = real.filter((d) => checkDraft(d.reply).length > 0);
  console.log(`\nReal drafts (${file}): reviewer raised concerns on ${flagged.length} of ${real.length}; regex blocks ${regexFlagged.length}.`);
  for (const d of flagged) {
    const regex = checkDraft(d.reply).map((i) => i.kind);
    console.log(`  ${d.id} reviewer: ${realConcerns.get(d.id)!.map((c) => `${c.kind} "${c.quote}"`).join("; ")}${regex.length ? `  | regex: ${regex.join(", ")}` : ""}`);
    console.log(`      ${d.reply.replace(/\s+/g, " ").slice(0, 150)}`);
  }
}

main().catch(fail);
