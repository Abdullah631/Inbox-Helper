// Checks a draft reply before a person can approve it. Pure code, no model, so it
// runs in the browser on every edit and gives the same answer every time.
//
// Anything inside [SQUARE_BRACKETS] is a placeholder the recruiter fills in, so
// it's ignored. "Let's meet [INTERVIEW_SLOT]" is fine. "Let's meet Monday at 3pm" is not.

import { DRAFT_MAX_WORDS } from "./limits";
import { hasInvisibleChars, hasMixedScript, skeleton } from "./text";

export type IssueKind =
  | "money" | "offer" | "date" | "decision" | "claims_action" | "company_fact"
  | "contact" | "hidden_chars" | "ai_leak" | "too_long" | "empty";

export type Issue = { kind: IssueKind; message: string; match?: string };

export const MAX_WORDS = DRAFT_MAX_WORDS;

// [NAME], [INTERVIEW_SLOT] and so on. Uppercase letters, digits, underscores, spaces.
const PLACEHOLDER = /\[[A-Z0-9_ ]+\]/g;

const RULES: { kind: IssueKind; message: string; patterns: RegExp[] }[] = [
  {
    kind: "money",
    message: "Mentions a pay figure. Salary talk has to come from a person.",
    patterns: [
      /[$€£₹]\s?\d/,
      /\b\d[\d,.]*\s?(k|usd|eur|gbp|pkr|inr|dollars|euros)\b/i,
      // Added Day 4 after the red-team: rupees, lakh, and amounts in words.
      /\b(rs\.?|pkr|inr)\s?\d/i,
      /\b(lakh|lakhs|crore|crores)\b/i,
      /\b(thousand|million)\s+(dollars|euros|pounds|rupees|a year|per year|a month|per month|annually)\b/i,
      /\b\d[\d,.]*\s+(dollars|euros|pounds|rupees)\b/i,
      /\b(salary|pay|compensation|package)\s+(of|is|will be|would be)\s+\S*\d/i,
    ],
  },
  {
    kind: "offer",
    message: "Sounds like an offer or a hiring promise.",
    patterns: [
      /\byou('re| are| have been)\s+(hired|selected|successful)\b/i,
      /\b(pleased|happy|delighted|excited)\s+to\s+(offer|extend|confirm (your|the) offer)/i,
      /\b(extend|make)\s+(you\s+)?an?\s+offer\b/i,
      /\bwe('d| would)\s+like\s+to\s+offer\b/i,
      /\b(the|this)\s+(job|role|position)\s+is\s+yours\b/i,
      /\bwelcome (to the team|aboard)\b/i,
      /\byou('ve| have)?\s+got\s+(the|this)\s+(job|role|position|offer)\b/i,
      /\b(offering|offer)\s+you\s+(the|this|a)\s+(job|role|position)\b/i,
      /\b(official|formal|final)\s+offer\b/i,
      /\byou('ve| have)?\s+made it\b/i,
    ],
  },
  {
    kind: "date",
    message: "Commits to a specific day or time. Use [INTERVIEW_SLOT] or [DATE] instead.",
    patterns: [
      // Any weekday at all. Even repeating the candidate's own day back reads as a confirmation.
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i,
      /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i,
      /\b\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(st|nd|rd|th)?\b/i,
      /\bwithin\s+\d+\s+(hours|days|business days|weeks)\b/i,
      /\b(tomorrow|tonight)\b/i,
      /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\.?\s+(at\s+)?\d/i,
      /\bat\s+\d{1,2}(:\d{2})?(?!\s*(%|percent|years?|days?|weeks?|months?|people|candidates))\b/i,
      /\bthe\s+\d{1,2}(st|nd|rd|th)\b/i,
    ],
  },
  {
    kind: "decision",
    message: "States a hiring decision. Only a person should send that.",
    patterns: [
      /\byou('ve| have)?\s+(passed|failed)\b/i,
      /\b(we|i) (have |'ve )?decided (not )?to\b/i,
      /\bnot (be )?moving forward\b/i,
      /\b(unfortunately|regret to inform)\b/i,
      /\byou (did not|didn't) (pass|make it)\b/i,
      /\b(cannot|can't|can not|won't|will not)\s+(be\s+)?(proceed|proceeding|progress|progressing|move forward|moving forward)\b/i,
      /\bwe regret\b/i,
    ],
  },
  {
    kind: "claims_action",
    message: "Says something was already done. Nothing has been done yet; write \"I'll\" instead, or do it first.",
    patterns: [
      /\b(i|we)('ve| have)\s+(already\s+|gone ahead and\s+)?(sent|resent|re-sent|added|forwarded|cancell?ed|scheduled|rescheduled|booked|updated|shared|confirmed|moved|removed|passed|escalated|deleted)\b/i,
      /\b(has|have) been (sent|resent|added|forwarded|cancell?ed|scheduled|rescheduled|booked|updated|confirmed|moved|removed)\b/i,
      /\bwill lock in\b/i,
    ],
  },
  {
    kind: "company_fact",
    message: "States a company policy or perk. The AI doesn't know these; check it or use a placeholder.",
    patterns: [
      // Not after "whether" or "if": "I'll check whether we have a referral program" is the safe phrasing.
      /(?<!\b(?:whether|if) )\bwe (do |don't |do not )?(have|offer|provide|support|sponsor|cover)\s+(a |an |any |full |)?(referral|relocation|visa|sponsorship|signing|bonus|equity|stock|remote|hybrid|flexible|benefits?|insurance|program)/i,
      /\b(the|this) (role|position|job) is (fully )?(remote|hybrid|on-?site|in-?office)\b/i,
      /\bour (policy|program|benefits?|package)( package| policy| program)? (is|includes|covers|offers)\b/i,
    ],
  },
  {
    kind: "contact",
    message: "Has a link or email address. Make sure it's ours, not one copied from a message.",
    patterns: [/\bhttps?:\/\/\S+/i, /\bwww\.\S+/i, /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/],
  },
  {
    kind: "ai_leak",
    message: "Talks about being an AI or about instructions. A candidate should never see that.",
    patterns: [/\bas an ai\b/i, /\b(language model|system prompt|my instructions)\b/i, /\bi('m| am) (just |only )?(an? )?(ai|assistant|bot|chatbot|language model)\b/i],
  },
];

// Matching runs on skeleton text (lib/text.ts): NFKC, invisible characters removed,
// curly quotes plain, look-alike letters mapped to Latin. Day 3 found curly
// apostrophes slipping past, Day 4 zero-width and Cyrillic letters, Day 5 Unicode
// tag characters. The hidden_chars issue still flags such text, because a reply
// containing them should be retyped, not just tolerated.
export function stripPlaceholders(text: string): string {
  return skeleton(text).replace(PLACEHOLDER, " ");
}

export function placeholdersIn(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER) ?? [])];
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function checkDraft(text: string): Issue[] {
  if (!text.trim()) return [{ kind: "empty", message: "The draft is empty." }];

  const plain = stripPlaceholders(text);
  const issues: Issue[] = [];
  if (hasInvisibleChars(text) || hasMixedScript(text)) {
    issues.push({ kind: "hidden_chars", message: "Has invisible or look-alike characters. Retype the reply in plain text." });
  }
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      const m = plain.match(p);
      if (m) {
        issues.push({ kind: rule.kind, message: rule.message, match: m[0].trim() });
        break;
      }
    }
  }

  const words = wordCount(text);
  if (words > MAX_WORDS) issues.push({ kind: "too_long", message: `${words} words. Keep it under ${MAX_WORDS}.` });
  return issues;
}
