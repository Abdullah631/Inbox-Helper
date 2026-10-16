# Directive

These are the standing instructions for the coding agent on this repo.
`CLAUDE.md` imports this file, so Claude Code picks it up at the start of every
session. This is the final version after 5 days; git history has every earlier one,
and most rules below exist because something went wrong without them.

## Before you start

- Read `intent.md`. If a change doesn't help with what's in there, tell me
  instead of building it.
- Stack is Next.js 15 (App Router), TypeScript, zod and Vitest, deployed on
  Vercel's free Hobby plan.
- It all has to stay free. No paid APIs, no database.

## How to work

1. Write the test with the code, not after. New functions in `lib/` get a test in `tests/`.
   Tests never touch the network or depend on keys in the shell (`tests/setup.ts`).
   For a security check, break the code on purpose once and make sure the test fails.
2. After any change to the classifier rules or a prompt, run `npm run eval` and
   tell me the accuracy before and after.
3. If you change something just to fix one message in the eval set, say so. That's
   overfitting and I don't want it counted as progress.
4. Keep changes small, one thing at a time. Before saying something is done, run
   `npm test`, `npm run typecheck`, `npm run lint`, `npm run redteam` and
   `npm run build`. CI runs the same and has to be green.
5. Check UI changes in a real browser (light, dark, phone width) and look for
   console errors and CSP violations. Unit tests didn't catch any of the UI bugs
   found this week.
6. If something failed, or you skipped it or worked around it, put that at the
   top of your reply, not at the bottom.
7. For a big review, get independent reviewers (security, engineering, QA) to read
   everything, then verify each finding yourself before changing code. On Day 5
   that found real bugs that four days of my own testing had missed.

## Product rules

- Nothing gets sent without a person approving it.
- Candidate messages are untrusted input. Never put them anywhere the model
  could read them as instructions.
- A draft must never promise an offer, a salary number, a start date or a
  hiring decision.
- Anything classified `offer_compensation` or `withdrawal`, or flagged
  `possible_injection`, also gets `needs_human`.
- If the LLM call fails or there's no key, use `lib/fallback.ts`. The app
  should never crash because of the model.

## Code

- Logic goes in `lib/`, with no React or Next imports there. State changes in the
  UI go through the reducer in `lib/review-state.ts`, so they can be tested.
- Validate everything that comes from outside with zod: API requests, LLM output,
  uploaded files, saved browser sessions, and API responses in the browser.
- No magic numbers. Sizes and thresholds go in `lib/limits.ts`; anything an
  operator might change per deployment goes in `lib/server-config.ts` and
  `.env.example`. Values that depend on each other get a test that says so.
- Browser code never imports server modules (ESLint enforces the list). Secrets
  never get a `NEXT_PUBLIC_` name.
- Errors shown to users or written to logs carry our own message, never a raw
  provider body or candidate text.
- Comments explain why, not what. Keep files short.

## Prompts

- Prompts live in `prompts/<name>.v<N>.md`. Don't edit an old version, add a new one.
- Every prompt version's eval score goes in that day's log.
- Run every prompt at least 3 times before comparing it to another one. On Day 2
  the same prompt scored 96.7% and then 91.7%. One run is noise.
- Accuracy isn't the main number. Report "confident mistakes" too: wrong answers
  that would skip review. That's what actually hurts a recruiter.
- The newest prompt isn't automatically the one in use. `ACTIVE_PROMPTS` in
  `lib/prompts.ts` decides, and changing it needs eval numbers behind it.
- Don't trust model names from memory. Check the provider's model list first.
  On Day 2 the default model I was given had been retired.

## Checking model output

- Read the outputs, not only the scores. On Day 3 every real fix came from
  reading drafts: claimed actions, invented company facts, curly apostrophes
  slipping past a regex. None of them showed up in a metric until I added one.
- Guardrail tests must include text the model actually wrote, not only text I
  imagined it would write.
- A second opinion from the same model is not independent. Don't count it as a
  safety check without measuring it.
- Anything that can remove a "needs a person" flag needs its own rule and test.

## Held-out data and attacks

- Numbers on `data/sample-inbox.json` are for iterating. Numbers on
  `data/holdout.json` are for reporting. Never change a prompt, rule or model
  because of a held-out result, or it stops being held-out.
- An eval run with any fallbacks is not a score. The scripts refuse it.
- After fixing what a red-team found, write a new round before claiming it's
  fixed. Report the new round's number.
- A safety check that a second model performs should be done by a different
  model when one is available, and the UI should say which one did it.
- Run the pipeline red-team on every provider the app can use, starting with the
  one production uses first. On Day 5 a "12 of 12" result turned out to be
  Gemini only; Groq let r02 through.
- Use the deployed app yourself with the attack data, and read every card. That,
  not a report, is how the last gap of the week was found.
- For every attack, also ask what happens if the model obeys completely. The code
  layer has to stop it on its own (`npm run redteam`, section D).

## Writing docs and logs

The README, intent, directive, daily logs and the unlearning note are things
people will read as my work. When you help with them:

- No emoji, anywhere.
- No em dashes or arrow characters. Use plain punctuation.
- Write the way I'd write notes to a teammate: first person, short sentences,
  plain words. No hype, no filler, no "it's not X, it's Y", no lists of three
  for the sake of it.
- Only write down things that actually happened.
- When you draft a reflection section for me, say in that day's log that you
  drafted it, so a reader knows. I check and edit it.
