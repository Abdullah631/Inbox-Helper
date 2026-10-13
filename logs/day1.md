# Day 1

## What I set out to do

Get a skeleton running that can group messages without any API key, build a
labeled sample set and a way to score against it. The idea is that on Day 2 the
LLM has a real number to beat instead of a feeling.

## How I worked

I used AI before writing any code. I pasted the brief and the job post and asked
which of the three options would stand out and how to build it for free. I went
with A, the inbox helper. B and C are mostly date math and if-statements, so the
AI wouldn't be doing much of the real work there.

Then I gave Claude Code one prompt for the whole day, "implement day one", and
let it build everything. After that I asked for one change: no emoji in anything
I hand in, and all docs written the way I'd write them myself.

Then I set up pushing. I showed it how my other project commits under my own
name with repo-only git settings, and asked for the same here, with no AI
co-author line in the commits. The template's first commit had been made under
the Mac's global git identity, which isn't mine, so it was folded into a single
Day 1 commit before anything was pushed. The first push failed with a 403
because the token saved in Keychain only covered my other repo. I made a new
token for this repo, swapped it in, and pushed.

## What got built

- A Next.js 15 + TypeScript app with a `/api/classify` route and a page that
  shows the groups, with flagged messages first.
- A keyword classifier (`lib/fallback.ts`). It gives a confidence score and three
  flags: possible_injection, needs_human, low_confidence.
- A parser that takes JSON, CSV or plain text split by `---`.
- 60 sample messages across 8 groups. About 20 are hard on purpose: Spanish,
  angry, two questions in one, two injection attempts.
- `npm run eval`, which prints accuracy, precision and recall per group, and
  every mistake, and saves each run to a file.
- 26 tests. Typecheck, lint and production build all pass. I also started the
  built app and sent real requests to the API to check it end to end.

## Numbers

Keyword classifier: 45 of 60 correct, 75%. Both injection attempts flagged.

All 60 labels were drafted by AI and haven't been checked by me yet. So right
now 75% means the keywords agree with the AI's guesses 75% of the time, which
is not the same as being right.

The worst group is status_check: only 4 of 9 found. Messages like "Did I pass?"
or "When do you expect to decide?" have no obvious keywords, and the rule that
scores question marks pulls them into the question group.

11 of the 15 misses had confidence under 0.5, so they'd show up flagged for
review anyway. Four had 0.5 or more and would not be flagged as unsure: the two
injection attempts (both still got needs_human), m53 and m60.

Correction made on Day 2: this paragraph first said 13 of 15. I had eyeballed
it. When I added a proper metric for it on Day 2 the real count was 11.

## What went wrong

- Installing Vitest failed with a peer dependency conflict. Vitest 5 wants
  `@types/node` 22 or newer and the Next template had 20. I bumped it to 24 to
  match my Node version instead of forcing the install.
- `npm audit` reports 7 vulnerabilities in build tooling that came with the
  template (braces, postcss). I left them. `audit fix --force` would pull in
  breaking changes. I'll look again on Day 5.
- `.gitignore` had `.env*`, which also hid `.env.example`. Added an exception.
- The first version of the parser had a messy function signature. It got
  cleaned up before the tests were written.
- The page ships zod to the browser because the parser runs client-side, which
  makes the bundle 103 kB. Fine for now.

## Decisions

- I didn't tweak the keywords to fix the 15 misses. They're the same 60
  messages I'm scoring on, so any fix would just be fitting to the test.
- Injection is a flag, not a group. A message can be a salary question and an
  injection attempt at the same time.
- Vercel only, no Render. One Next.js app covers both the page and the API.

## Still to do today

- [ ] Go through all 60 labels myself, fix the wrong ones, set `label_source`
      to "human", and re-run the eval.
- [ ] Read `intent.md` and change anything I don't agree with.
- [x] Commit, push to GitHub, deploy on Vercel. (URL still not in the README.)
- [ ] Look up the current Groq and Gemini free tier limits and note them here.

## Habit I dropped today

Starting by writing code. Normally I'd open an editor, scaffold the project by
hand and pick the stack from habit. Today I didn't write a line myself. I asked
the AI which project to pick and why, gave it one prompt for the whole day, and
spent my time reading what it built and deciding what to keep.

## What surprised me

That it argued against making its own numbers look better. It could have tuned
the keyword rules until the 60 sample messages scored close to 100%. Instead it
left the baseline at 75%, said tuning on the test set would be cheating, and
marked all 60 labels as "AI-proposed, not checked". I expected to have to push
for that kind of honesty, not get it by default.

The other surprise was how much of the day went to plumbing that had nothing to
do with AI: git identity, a Keychain token, a 403. That part was slower than the
whole build.
