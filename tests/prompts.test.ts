import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTENTS } from "@/lib/intents";
import { ACTIVE_PROMPTS, activeVersion, fillTemplate, listVersions, loadPrompt, type PromptName } from "@/lib/prompts";
import { readServerConfig } from "@/lib/server-config";

describe("prompts on disk", () => {
  it.each(Object.keys(ACTIVE_PROMPTS) as PromptName[])("the active %s prompt exists and fills cleanly", (name) => {
    const p = loadPrompt(name, ACTIVE_PROMPTS[name]);
    expect(p.version).toBe(ACTIVE_PROMPTS[name]);
    expect(p.text).not.toMatch(/\{\{/);
  });

  it("every prompt file fills without leftover placeholders", () => {
    for (const file of readdirSync("prompts")) {
      const [name, version] = file.split(".");
      expect(() => loadPrompt(name, version), file).not.toThrow();
    }
  });

  it("classify prompts list every intent", () => {
    const p = loadPrompt("classify", ACTIVE_PROMPTS.classify);
    for (const intent of INTENTS) expect(p.text).toContain(`- ${intent}:`);
  });
});

describe("activeVersion", () => {
  it("uses the env override when set, otherwise ACTIVE_PROMPTS", () => {
    expect(activeVersion("draft", readServerConfig({}))).toBe(ACTIVE_PROMPTS.draft);
    expect(activeVersion("draft", readServerConfig({ DRAFT_PROMPT_VERSION: "v1" }))).toBe("v1");
    expect(activeVersion("critic", readServerConfig({ CRITIC_PROMPT_VERSION: "" }))).toBe(ACTIVE_PROMPTS.critic);
  });
});

describe("loadPrompt", () => {
  it("sorts versions numerically and errors on unknown ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-"));
    for (const v of ["v1", "v2", "v10"]) writeFileSync(join(dir, `classify.${v}.md`), v);
    expect(listVersions("classify", dir)).toEqual(["v1", "v2", "v10"]);
    expect(loadPrompt("classify", undefined, dir).version).toBe("v10");
    expect(() => loadPrompt("classify", "v9", dir)).toThrow(/have: v1, v2, v10/);
  });

  it("can't be pointed outside the prompts folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-"));
    writeFileSync(join(dir, "classify.v1.md"), "x");
    expect(() => loadPrompt("classify", "../../etc/passwd", dir)).toThrow(/No prompt/);
    expect(listVersions("../classify", dir)).toEqual(["v1"]);
  });
});

describe("fillTemplate", () => {
  it("accepts spacing inside the braces and rejects unknown placeholders", () => {
    expect(fillTemplate("{{ INTENTS }}")).toContain("- scheduling:");
    expect(() => fillTemplate("Hello {{NAME}}")).toThrow(/unknown placeholder \{\{NAME\}\}/);
  });
});
