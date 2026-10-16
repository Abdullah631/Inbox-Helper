// Text clean-up shared by the guardrails, the injection detector and the reviewer's
// quote check. They used to normalize differently, which is how the Day 5 review
// found a guardrail bypass with invisible Unicode "tag" characters.

// Characters that render as nothing (zero-width, soft hyphen, word joiner, BOM),
// bidirectional controls that can reorder visible text, and Unicode tag characters.
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/gu;
const HAS_INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/u;

// Cyrillic and Greek letters that look like Latin ones. Mapping them lets pattern
// checks see "hіred" (with a Cyrillic і) as "hired".
const LOOKALIKES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y",
  "х": "x", "і": "i", "ѕ": "s", "ј": "j", "ԁ": "d", "һ": "h",
  "А": "A", "Е": "E", "О": "O", "Р": "P", "С": "C", "Х": "X",
  "І": "I", "Ѕ": "S", "Ј": "J", "К": "K", "М": "M", "Н": "H",
  "Т": "T", "В": "B", "ο": "o", "α": "a", "ε": "e", "ι": "i",
  "Ο": "O", "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I",
  "Κ": "K", "Μ": "M", "Ν": "N", "Ρ": "P", "Τ": "T", "Χ": "X",
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKES).join("")}]`, "g");

export function hasInvisibleChars(text: string): boolean {
  return HAS_INVISIBLE.test(text);
}

// A Latin letter right next to a Cyrillic or Greek one, which real text almost never has.
export function hasMixedScript(text: string): boolean {
  return /[a-z][Ͱ-ϿЀ-ӿ]|[Ͱ-ϿЀ-ӿ][a-z]/i.test(text);
}

// For matching patterns: compatibility forms folded (NFKC turns fullwidth "１０" into
// "10"), invisible characters removed, curly quotes and dashes made plain.
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, "-");
}

// normalizeForMatch plus look-alike letters mapped to Latin. Only for detection,
// never for text shown to anyone.
export function skeleton(text: string): string {
  return normalizeForMatch(text).replace(LOOKALIKE_RE, (c) => LOOKALIKES[c]);
}
