import { classifyWithLlm } from "./classify-llm";
import { classifyFallback } from "./fallback";
import { getProvider, type LlmProvider } from "./llm";
import { ACTIVE_PROMPTS, loadPrompt, type Prompt } from "./prompts";
import type { Classification, Message } from "./schema";

export type Mode = "auto" | "llm" | "keyword";

export type ClassifyResult = {
  classifications: Classification[];
  method: "llm" | "keyword";
  provider?: string;
  model?: string;
  promptVersion?: string;
  warnings: string[];
};

export class NoProviderError extends Error {}

type Deps = { provider?: LlmProvider | null; prompt?: Prompt };

// Shared by the API route and the eval script, so the eval measures exactly
// what users get.
export async function classifyInbox(messages: Message[], mode: Mode, deps: Deps = {}): Promise<ClassifyResult> {
  const provider = deps.provider === undefined ? getProvider() : deps.provider;

  if (mode === "keyword" || (mode === "auto" && !provider)) {
    const warnings = mode === "auto" ? ["No LLM key is configured, so keywords were used."] : [];
    return { classifications: messages.map(classifyFallback), method: "keyword", warnings };
  }
  if (!provider) throw new NoProviderError("AI mode needs GROQ_API_KEY or GEMINI_API_KEY on the server.");

  const prompt = deps.prompt ?? loadPrompt("classify", process.env.CLASSIFY_PROMPT_VERSION || ACTIVE_PROMPTS.classify);
  const { classifications, warnings } = await classifyWithLlm(messages, provider, prompt);
  return {
    classifications,
    method: "llm",
    provider: provider.name,
    model: provider.model,
    promptVersion: prompt.version,
    warnings,
  };
}
