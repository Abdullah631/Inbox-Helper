import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Modules that read API keys, files or env. Browser code must never import them, or
// they (and anything they import) end up in the JavaScript sent to every visitor.
const SERVER_ONLY = [
  "@/lib/server-config", "@/lib/llm", "@/lib/llm-json", "@/lib/prompts", "@/lib/api",
  "@/lib/classify", "@/lib/classify-llm", "@/lib/draft", "@/lib/critic", "@/lib/rate-limit",
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"],
  },
  {
    files: ["app/page.tsx", "app/layout.tsx", "components/**/*.{ts,tsx}", "hooks/**/*.ts", "lib/client/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: SERVER_ONLY.map((name) => ({ name, message: "Server-only module: it reads secrets or files. Call the API instead." })),
          patterns: [{ group: ["node:*", "fs", "path"], message: "Browser code can't use Node APIs." }],
        },
      ],
    },
  },
];

export default eslintConfig;
