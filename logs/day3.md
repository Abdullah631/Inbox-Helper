# Day 3

## What I set out to do

Draft a reply for every message, put guardrails on those drafts, and build the
review flow: edit, approve, don't reply, export. Before that, deal with the
problem Day 2 left open. The classifier is sometimes confidently wrong, and a
draft written for the wrong group is a confidently wrong reply.

## Load added today

Drafting, guardrails, a dispute check, a full review UI and a second eval
script, in one day. I also started reading the model's output line by line
instead of only looking at the numbers. Most of what I fixed today came from that.

## Before Day 3 proper: checking the API keys

I asked whether the keys in `.env.local` actually work. Groq did. Gemini's key
was fine, but the default Gemini model in my code (`gemini-2.5-flash`) has been
retired for new accounts. It still shows up in Google's model list but refuses
requests. Switched to `gemini-3.8-flash` after a real request worked. The next
try hit a 503 (model overloaded), and my code only retried 429s, so I added 503.
`scripts/check-provider.ts` now sends two real messages through the app to
check a provider end to end. The xAI key in the file has no credits. Second
retired-model surprise in two days.

## What got built

- `lib/guardrails.ts`: plain code checks run on every draft, in the browser, on
  every keystroke. Blocks pay figures, offer or hiring language, any day, date
  or time, hiring decisions, claims that something was already done, claims
  about company policy, talk about being an AI, and drafts over 120 words.
  Anything in [BRACKETS] is a placeholder and ignored.
- `lib/draft.ts` with `prompts/draft.v1.md` and `draft.v2.md`. Batches of 10,
  zod validation, one retry, template fallback per batch.
- `lib/templates.ts`: one reply per group, used with no API key or when the
  model fails. A test makes sure every template passes the guardrails.
- Messages flagged as injection attempts never go back to the model. The card
  says so and leaves the reply for a person to write.
- The dispute check: while writing the reply, the model also names the group
  it thinks the message belongs to. If that differs from the classifier, the
  card shows "Move to X / Keep".
- Review UI. Each card has an editable reply. Approve is locked until the
  guardrails pass and no placeholders are left, and it says why. "Sign replies
  as" fills in the recruiter name. The candidate's first name is guessed from
  the email address and left visible for editing. Filters for To do and Done,
  a progress bar, and CSV or JSON export of approved replies. Export stands in
  for sending.
- `npm run eval:drafts`: runs drafting over the 60 messages and reports
  guardrail blocks, disputes against the classifier's known mistakes, and
  writes `evals/results/drafts-latest.md` so a person can read every draft.
- 133 tests, up from 54.

## Numbers

All runs reuse the same saved classification (Day 2, prompt v1), so the
classifier's 3 confident mistakes (m39, m54, m60) are the same every time.
Blocked counts are re-scored with the final guardrails so v1 and v2 are judged
by the same rules.

| Draft prompt | Clean runs | Drafts blocked | Claimed actions | Confident mistakes caught by dispute | Disputes on correct groups |
|---|---|---|---|---|---|
| v1 (shown the group) | 3 | 10, 10, 12 of 58 | 5 every run | 0, 0, 0 of 3 | 0, 0, 0 |
| v2 (blind) | 4 | 5, 5, 5, 5 of 58 | 0 | 1, 0, 1, 0 of 3 | 2, 1, 1, 0 |

v2 is the active draft prompt.

## What went wrong

- The dispute idea mostly doesn't work. In v1 the model was shown the
  classifier's group and agreed with it every time, which is anchoring. In v2
  I hid the group so it had to decide on its own. It then caught m39 in half
  the runs and never caught m54 or m60, because the same model makes those
  mistakes the same way every time. A second opinion from the same model isn't
  independent. I kept it because it's free (no extra calls) and the false alarm
  rate is low, but it is not the fix for confident mistakes. That problem is
  still open.
- A dispute pointed the wrong way. m53 asks about a reschedule and the salary
  range. The classifier correctly put it in Offer (riskier wins). The drafting
  step suggested Scheduling, and the "Move" button would have removed the
  "needs a person" flag. Disputes can now never move a message out of a
  sensitive group. I found this from a screenshot, not from a test.
- My guardrails had a hole: models write curly apostrophes, and my patterns
  only matched straight ones. "You're hired" typed with a curly apostrophe would
  have passed the offer check.
  While fixing it I found "You've passed" also slipped through with a straight
  apostrophe, because the pattern expected a space after "you". My first test
  set never tried that form.
- Reading the v1 drafts turned up a whole class the guardrails didn't cover:
  claims that something was already done ("I've cancelled your interview",
  "I've resent the invite"). None of that had happened. One of my own templates
  said "I've added it to your application". New guardrail, template fixed, and
  v2 tells the model nothing has been done yet. Claimed actions went from 5 per
  run to 0.
- The model invents company facts. v1 said "we do have a referral program" and
  "we're not looking for external sourcing tools". v2's prompt forbids this and
  m36 still says "we do have a referral program" every run. Added a narrow
  company_fact guardrail. To be honest, it was written after seeing m36, so it
  might be fitted to that message more than I'd like. I tried to keep it to the
  topics in the question group's own description (visa, relocation, remote,
  benefits, programs).
- The model keeps repeating days and times from the candidate's message
  ("I'll resend the invite for Monday") even when told not to. The guardrail
  catches it every time. That's 4 of the 5 blocks per v2 run.
- Groq's free tier allows 8,000 tokens a minute. One draft eval ran out after
  two quick retries and 10 messages fell back to templates (that run is left
  out of the table). Retries now use the wait time Groq asks for, up to 3 times.
  Sorting and drafting 60 messages through the app took 146 seconds. That's the
  token limit, not the code: 60 messages need roughly 22k tokens. Too slow for
  a real recruiter on the free tier.
- The reply box cut off drafts with line breaks, so on an approved card you
  couldn't see the full reply you'd just approved. Found in a screenshot. Fixed.
- I first wrote a test expecting the name guess for a missing sender to be
  "Unknown", which would have produced "Hi Unknown". Changed the behavior, not
  just the test.
- I set draft v2 as active before measuring it, which breaks my own directive.
  The numbers ended up supporting it, but the order was wrong.
- I wrote `await` inside a non-async callback. Typecheck caught it, and it had
  also silently stopped one test file from loading (84 tests ran instead of 131).

## Decisions

- Guardrails are the backstop, the prompt is the first line. The prompt cut
  problems in half; the code catches the rest and makes a person look.
- Approve stays locked until guardrails pass and placeholders are filled.
  There's no "approve anyway". If that turns out too strict, the person can
  edit the text, which is the point.
- Injection attempts get no AI draft at all, not even a sanitized one.
- Sending is an export for now. Connecting to email is out of scope.

## Still to do

- [ ] Review the 60 labels by hand (carried over since Day 1).
- [ ] A held-out set I never tune against. Day 4.
- [ ] Red-team set for drafts and for the review flow. Day 4.
- [ ] Review progress is lost on refresh. Not acceptable for a real reviewer.
- [ ] Rate-limit errors from Groq include the organization id and get shown in
      the UI warning. Trim provider errors before they reach the browser.

## Habit I dropped today

Taking "it's configured" as "it works". Before today I'd have assumed the keys
in .env.local were fine because the app started. I asked for them to be
actually tested, and that found a retired Gemini model and a missing retry for
503 errors. Neither would have shown up until the backup provider was needed.

Same with the drafts: I stopped judging them by the metric. The guardrail
numbers looked fine on the first run. Reading the drafts one by one is what
showed replies saying "I've cancelled your interview" when nothing had been
cancelled.

## What surprised me

That a second opinion from the same model is barely a second opinion. The idea
of having the drafting step double-check the group sounded solid. Shown the
classifier's answer, the model agreed every time. With the answer hidden, it
still made the same mistakes, because it's the same model reading the same
words. I expected that to catch most of the confident mistakes. It caught one,
half the time.

Also that a curly apostrophe could get "You're hired" past a safety check. It's
the kind of bug I'd never have thought to test for without looking at what the
model really writes.
