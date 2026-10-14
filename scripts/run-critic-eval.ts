// Usage: npm run eval:critic [-- --provider gemini|groq]
// Measures the AI reviewer two ways:
//   1. red-team drafts (both rounds): caught by regex, by the reviewer, by either
//   2. 58 real drafts from a saved run: how many get concerns (false alarm rate),
//      printed so a person can judge each one
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { criticize, pickCriticProvider } from "../lib/critic";
import { loadPrompt } from "../lib/prompts";
import { checkDraft } from "../lib/guardrails";
import { getProvider, getProviders } from "../lib/llm";

const root = join(__dirname, "..");
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));
const args = process.argv.slice(2);
const promptVersion = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : "v1";
// --drafts <file> picks which saved draft run to check for false alarms.
const draftsFile = args.includes("--drafts") ? args[args.indexOf("--drafts") + 1] : undefined;
const only = args.includes("--provider") ? (args[args.indexOf("--provider") + 1] as "groq" | "gemini") : undefined;

async function main() {
  const provider = only ? getProvider(process.env, { only, failover: false }) : pickCriticProvider(null, getProviders());
  if (!provider) throw new Error("Needs an API key in .env.local");
  const prompt = loadPrompt("critic", promptVersion);
  console.log(`Reviewer model: ${provider.model}, critic prompt ${prompt.version}\n`);

  const red = JSON.parse(readFileSync(join(root, "data/redteam.json"), "utf8")).drafts as
    { id: string; text: string; should_block: boolean; attack: string; round: number }[];
  const concerns = await criticize(red.map((d) => ({ id: d.id, reply: d.text })), provider, prompt);

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

  const file = draftsFile ?? readdirSync(join(root, "evals/results")).filter((f) => /^drafts-v2-.*\.json$/.test(f)).sort().at(-1)!;
  const real = (JSON.parse(readFileSync(join(root, "evals/results", file.replace(/^evals\/results\//, "")), "utf8")).drafts as { id: string; reply: string; source: string }[])
    .filter((d) => d.source === "llm");
  const realConcerns = await criticize(real.map((d) => ({ id: d.id, reply: d.reply })), provider, prompt);
  const flagged = real.filter((d) => realConcerns.get(d.id)!.length > 0);
  const regexFlagged = real.filter((d) => checkDraft(d.reply).length > 0);
  console.log(`\nReal drafts (${file}): reviewer raised concerns on ${flagged.length} of ${real.length}; regex blocks ${regexFlagged.length}.`);
  for (const d of flagged) {
    const regex = checkDraft(d.reply).map((i) => i.kind);
    console.log(`  ${d.id} reviewer: ${realConcerns.get(d.id)!.map((c) => `${c.kind} "${c.quote}"`).join("; ")}${regex.length ? `  | regex: ${regex.join(", ")}` : ""}`);
    console.log(`      ${d.reply.replace(/\s+/g, " ").slice(0, 150)}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
