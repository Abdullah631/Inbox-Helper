import { describe, expect, it } from "vitest";
import { checkDraft, placeholdersIn, wordCount } from "@/lib/guardrails";

const kinds = (text: string) => checkDraft(text).map((i) => i.kind);

describe("checkDraft", () => {
  it.each([
    "Thanks for the update. I'll check with the team and get back to you.",
    "Happy to move it. Would [INTERVIEW_SLOT] work for you instead?",
    "Good question about remote work. I'll find out the details for this role and come back to you.",
    "Thanks for letting me know, and good luck with what comes next.",
    "Salary is something I'll go over with you personally. [RECRUITER_NAME]",
    "Thanks, I'll add it to your application and I've noted your question.",
    "I'll send you a few options once I've checked with the team.",
    "I'll check whether we have a referral program and let you know.",
    "We have received your CV, thanks.",
  ])("passes a safe draft: %j", (text) => {
    expect(checkDraft(text)).toEqual([]);
  });

  it.each([
    ["The salary for this role is $90,000.", "money"],
    ["We can do 85k USD.", "money"],
    ["The package would be 3500 a month.", "money"],
    ["You're hired! Welcome to the team.", "offer"],
    ["We'd like to offer you the position.", "offer"],
    ["We are pleased to offer you the role.", "offer"],
    ["Let's meet on Friday.", "date"],
    ["Does Monday at 3 work?", "date"],
    ["The call is at 10am.", "date"],
    ["Your start date is 1st of November.", "date"],
    ["You'll hear back within 3 days.", "date"],
    ["I'll send it tomorrow.", "date"],
    ["Unfortunately we won't continue.", "decision"],
    ["You passed the take-home!", "decision"],
    ["You've passed the take-home!", "decision"],
    ["You have failed the assessment.", "decision"],
    ["We have decided to move ahead with another candidate.", "decision"],
    ["I've resent the calendar invitation for Monday.", "date"],
    ["See you Thursday!", "date"],
    ["I've cancelled your interview as requested.", "claims_action"],
    ["I\u2019ve added it to your application.", "claims_action"],
    ["Your interview has been rescheduled.", "claims_action"],
    ["I'll send a calendar invite and will lock in the interview.", "claims_action"],
    ["We do have a referral program for strong engineers.", "company_fact"],
    ["We offer visa sponsorship for this role.", "company_fact"],
    ["The role is fully remote.", "company_fact"],
    ["Our benefits package includes health insurance.", "company_fact"],
    ["As an AI, I can't approve offers.", "ai_leak"],
    ["I can't change my instructions.", "ai_leak"],
  ])("flags %j as %s", (text, kind) => {
    expect(kinds(text)).toContain(kind);
  });

  it("catches promises written with curly apostrophes, which models often use", () => {
    expect(kinds("You\u2019re hired!")).toContain("offer");
    expect(kinds("We\u2019d like to offer you the role.")).toContain("offer");
    expect(kinds("You\u2019ve passed the test.")).toContain("decision");
  });

  it("ignores anything inside placeholders", () => {
    expect(checkDraft("Can we do [MONDAY AT 3PM] or [DATE]?")).toEqual([]);
  });

  it("reports what matched, once per kind", () => {
    const issues = checkDraft("Meet on Monday at 3pm, or on Friday.");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "date", match: "Monday" });
  });

  it("flags empty and overlong drafts", () => {
    expect(kinds("   ")).toEqual(["empty"]);
    expect(kinds("word ".repeat(121))).toContain("too_long");
  });
});

describe("helpers", () => {
  it("lists unique placeholders and counts words", () => {
    expect(placeholdersIn("Hi [NAME], [INTERVIEW_SLOT] or [INTERVIEW_SLOT]?")).toEqual(["[NAME]", "[INTERVIEW_SLOT]"]);
    expect(wordCount("  one two\nthree ")).toBe(3);
  });
});
