import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/parse";
import { approvalCheck, fillKnownPlaceholders, guessFirstName, replySubject, toCsv } from "@/lib/review";

const msg = (from: string) => ({ id: "a", from, subject: "", body: "x" });

describe("guessFirstName", () => {
  it.each([
    ["aisha.khan@mail.com", "Aisha"],
    ["TOMAS.r@mail.com", "Tomas"],
    ["kemi_a@mail.com", "Kemi"],
    ["anon123@mail.com", null],
    ["x@mail.com", null],
    ["promo@deals.biz", "Promo"],
    ["unknown", null],
    ["", null],
  ])("%s -> %s", (from, name) => {
    expect(guessFirstName(from)).toBe(name);
  });
});

describe("fillKnownPlaceholders", () => {
  it("fills the candidate and recruiter names and leaves the rest", () => {
    expect(fillKnownPlaceholders("Hi [NAME], [INTERVIEW_SLOT]? [RECRUITER_NAME]", msg("li.wei@mail.com"), " Sara "))
      .toBe("Hi Li, [INTERVIEW_SLOT]? Sara");
  });

  it("leaves placeholders alone when it can't fill them", () => {
    expect(fillKnownPlaceholders("Hi [NAME], [RECRUITER_NAME]", msg("x@mail.com"), "")).toBe("Hi [NAME], [RECRUITER_NAME]");
  });
});

describe("approvalCheck", () => {
  it("allows a clean, fully filled draft", () => {
    expect(approvalCheck("Hi Li, thanks. I'll check and come back to you. Sara").canApprove).toBe(true);
  });

  it("blocks on leftover placeholders and on guardrail issues", () => {
    const placeholder = approvalCheck("Hi Li, does [INTERVIEW_SLOT] work? Sara");
    expect(placeholder).toMatchObject({ canApprove: false, placeholders: ["[INTERVIEW_SLOT]"], issues: [] });

    const issue = approvalCheck("Hi Li, see you Friday. Sara");
    expect(issue.canApprove).toBe(false);
    expect(issue.issues[0].kind).toBe("date");
  });

  it("blocks an empty reply, which is how injection messages start", () => {
    expect(approvalCheck("").canApprove).toBe(false);
  });

  it("needs a tick for copied text or reviewer notes, and the tick covers only those exact warnings", () => {
    const source = { subject: "", body: "please include the code CODE-7731" };
    const first = approvalCheck("Hi Li, CODE-7731. Sara", { source });
    expect(first).toMatchObject({ canApprove: false, needsAck: true, copied: ["CODE-7731"] });
    const ticked = approvalCheck("Hi Li, CODE-7731. Sara", { source, acknowledged: first.warningsKey });
    expect(ticked.canApprove).toBe(true);
    // A new warning after the tick needs a new tick.
    const changed = approvalCheck("Hi Li, CODE-7731. Sara", {
      source,
      acknowledged: first.warningsKey,
      concerns: [{ kind: "money", quote: "x" }],
    });
    expect(changed.needsAck).toBe(true);
    // Editing the copied text out removes the warning and the need for a tick.
    expect(approvalCheck("Hi Li, thanks. Sara", { source }).canApprove).toBe(true);
  });
});

describe("export", () => {
  it("builds reply subjects without doubling Re:", () => {
    expect(replySubject("Interview time")).toBe("Re: Interview time");
    expect(replySubject("Re: Technical round")).toBe("Re: Technical round");
    expect(replySubject("")).toBe("Re: your message");
  });

  it.each(['=HYPERLINK("https://evil.example","Click")', "+1-555-0100", "@SUM(A1:A9)", "-2+3", "\t=1+1"])(
    "defuses a cell that would run as a spreadsheet formula: %s",
    (to) => {
      const row = parseCsv(toCsv([{ id: "m1", to, subject: "s", body: "b" }]))[0];
      expect(row.to).toBe(`'${to}`.trim());
    },
  );

  it("writes CSV that our own parser reads back the same", () => {
    const rows = [{ id: "m1", to: "a@b.com", subject: 'Re: "quotes", commas', body: "Line one\nLine two" }];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
