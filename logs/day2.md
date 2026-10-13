# Day 2

## What I set out to do

Put an LLM behind the classifier, measure it against the keyword baseline, and
iterate on the prompt with numbers. Also rebuild the UI. The Day 1 page worked
but looked like a form from 2005.

## Load added today

Two jobs in one day instead of one: the LLM work and a full UI rebuild. I also
held the LLM to a stricter bar than accuracy (see "confident mistakes" below).

## Prompts used

1. "okay now lets proceed to day 2 and we need to make sure the UI isn't this bad
   it should be proper with a proper header aligned buttons perfect textboxes
   mode toggles and all"

Everything below came out of that one prompt, plus Claude Code reading its own
eval output and deciding what to try next. I reviewed the decisions after.

2. "yeah commit" (after reading the results)
3. "you have checked out the .env.local are those api keys working?" That one
   turned into Day 3's first job, see day3.md.

## What got built

- `lib/llm.ts`: one small interface over Groq and Gemini, plain fetch, retries on
  429 with the retry-after header, 25 second timeout.
- `lib/classify-llm.ts`: sends messages in batches of 10, validates the JSON with
  zod, retries once with the error message, and falls back to keywords for any
  batch that still fails. The UI shows which method handled each message.
- Flags moved into `lib/flags.ts` and are decided in code for both classifiers.
  The model can add an injection flag but can't remove one.
- Prompts are files: `prompts/classify.v1.md`, `classify.v2.md`. The active one
  is pinned in `lib/prompts.ts`, not "whatever is newest".
- `npm run eval -- --llm --prompt v1` runs the LLM eval. Every run is saved and
  gets a line in `evals/history.csv`.
- New UI: sticky header, light/dark/system theme toggle that doesn't flash on
  load, Auto/AI/Keywords switch (AI is disabled when the server has no key),
  file upload, live "60 messages, JSON" status under the box, progress bar,
  stat tiles, filter tabs per group, and cards with confidence meters. Checked
  in headless Chrome at desktop and phone width, light and dark. No horizontal
  scroll at 390px, no console errors.
- 54 tests, up from 26.

## Numbers

All runs use `openai/gpt-oss-120b` on Groq, on the same 60 messages.

| Classifier | Runs | Accuracy per run | Mean | Confident mistakes per run |
|---|---|---|---|---|
| Keywords | 1 | 75.0 | 75.0% | 4 |
| Prompt v1 | 3 | 95.0, 95.0, 93.3 | 94.4% | 3, 3, 3 |
| Prompt v2 | 3 | 96.7, 91.7, 95.0 | 94.4% | 2, 5, 3 |

"Confident mistakes" means wrong and confidence of 0.5 or more, so the message
would not be flagged as unsure. Both injection attempts were flagged in every run.

The LLM is a big jump on accuracy. On safety it isn't better yet. The keyword
classifier is wrong a lot but usually knows it. The LLM is wrong less often but
says 0.9 when it is. In the UI that looks like m60 ("Please cancel my
interview, I'll reapply in a few months") sitting under Scheduling at 95% with
no flag. In keyword mode 36 of 60 messages end up flagged for review; with the
LLM it's 17. Fewer flags is only good if the unflagged ones are right.

## What went wrong

- The default model I was handed, `llama-3.3-70b-versatile`, doesn't exist on
  Groq anymore. Found it by listing the models before the first run. Switched
  to `openai/gpt-oss-120b`. It's configurable with `GROQ_MODEL`.
- Prompt v2 was supposed to fix the confidence problem. It asks the model to
  name its second choice and follow a confidence scale. It didn't work. Same
  mean accuracy, more spread between runs, and one run sent an offer start date
  question (m19) to Scheduling at 0.7, which is the exact kind of miss I care
  about. v1 stays active.
- I tried one more idea on the saved results: flag a message whenever the LLM
  and the keyword classifier disagree. It caught 1 of v1's 3 confident mistakes
  and would have flagged 12 to 14 correct messages as well. Rejected. A review
  flag that's mostly noise trains people to ignore it.
- My own eval script counted keyword results as LLM fallbacks (60 of 60) in the
  first version of the history file. Caught it in the output, fixed it before
  keeping any numbers.
- `tsc` caught a type error in a test helper that the test runner was happy
  with. Lint caught an `any` that would have failed the Vercel build.
- The Day 1 log said 13 of the 15 keyword misses were low confidence. The real
  number is 11. I'd eyeballed it. Corrected in day1.md with a note.
- Free tier rate limits are real. The first LLM eval took 17 seconds, later ones
  took 64 to 79 seconds because of 429 retries. On Vercel each request has a 60
  second limit, so a big inbox during a busy minute could time out. The UI sends
  20 messages per request to keep each call small, but I haven't load tested it.

## Decisions

- v1 is the active prompt. v2 stays in the repo with its results.
- I did not add prompt rules aimed at the specific messages it got wrong
  (for example "cancel means withdrawal"). That would raise the score on this
  set without telling me anything about new messages.
- m54 ("Got the offer, thanks! When's my first day and who do I send my ID
  to?") is labeled documents, and the model says offer_compensation every time.
  Honestly the model's answer is defensible, and it's the safer one because it
  routes to a person. That's a label question for my review, not a prompt fix.
- Model confidence is not good enough to decide what skips review. That's the
  main problem to solve before drafts go in on Day 3, because a confidently
  wrong group means a confidently wrong reply.

## Still to do

- [ ] Review the 60 labels by hand (carried over from Day 1, still not done).
- [x] Add `GROQ_API_KEY` to the Vercel project settings, otherwise the live site
      runs in keyword mode.
- [ ] Build a small held-out set of messages I never tune against. Every number
      so far is on the same 60.

## Habit I dropped today

Trusting one good number. My old instinct would have been to see 96.7% for
prompt v2, call it an improvement and move on. Running every prompt three times
showed the same prompt also scoring 91.7%, and that v2 was no better than v1 on
average. I now treat a single run as an anecdote, and that rule went into
directive.md so the AI follows it too.

I also stopped treating "it looks fine in my head" as a UI review. The UI was
checked in a real browser at phone and desktop width before I called it done.

## What surprised me

Two things. First, the model name the AI picked from memory didn't exist
anymore. If it hadn't checked Groq's model list before running, the whole day
would have quietly run on the keyword fallback and the numbers would have meant
nothing.

Second, the better model was worse in the way that matters. The LLM got 94%
against 75% for keywords, but when it was wrong it said it was 95% sure, while
the keyword rules were usually unsure when they were wrong. For a tool whose
safety depends on a person reviewing the risky ones, "less often wrong but
confident about it" is a real trade-off, not an upgrade.
