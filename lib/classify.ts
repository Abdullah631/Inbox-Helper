import { classifyWithLlm } from "./classify-llm";
import { classifyFallback } from "./fallback";
import { getProvider, type CallOptions, type LlmProvider } from "./llm";
import { loadActivePrompt, type Prompt } from "./prompts";
import type { Classification, Message, Mode } from "./schema";

export type { Mode };

export type ClassifyResult = {
  classifications: Classification[];
  method: "llm" | "keyword";
  provider?: string;
  model?: string;
  promptVersion?: string;
  warnings: string[];
};

export class NoProviderError extends Error {
  constructor() {
    super("AI mode needs GROQ_API_KEY or GEMINI_API_KEY on the server.");
    this.name = "NoProviderError";
  }
}

type Deps = { provider?: LlmProvider | null; prompt?: Prompt; signal?: AbortSignal };

// Shared by the API route and the eval script, so the eval measures exactly
// what users get.
export async function classifyInbox(messages: Message[], mode: Mode, deps: Deps = {}): Promise<ClassifyResult> {
  const provider = deps.provider === undefined ? getProvider() : deps.provider;

  if (mode === "keyword" || (mode === "auto" && !provider)) {
    const warnings = mode === "auto" ? ["No LLM key is configured, so keywords were used."] : [];
    return { classifications: messages.map(classifyFallback), method: "keyword", warnings };
  }
  if (!provider) throw new NoProviderError();

  const prompt = deps.prompt ?? loadActivePrompt("classify");
  const opts: CallOptions = { signal: deps.signal };
  const { classifications, warnings } = await classifyWithLlm(messages, provider, prompt, opts);
  const answered = classifications.some((c) => c.method === "llm");
  return {
    classifications,
    method: "llm",
    provider: answered ? provider.name : undefined,
    model: answered ? provider.model : "no model answered",
    promptVersion: prompt.version,
    warnings,
  };
}
