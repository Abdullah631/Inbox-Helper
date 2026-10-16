# Inbox Helper

You paste in a batch of candidate messages. It sorts them by what each person is
asking for, flags the ones that need a careful answer, and drafts a reply for
each one. You edit and approve every reply, then export the approved ones.
Nothing is sent automatically.

Live: https://inbox-helper-alpha.vercel.app

Built over 5 days with AI as my main way of working. The goal and success
measures are in `intent.md`, the standing instructions for the coding agent are
in `directive.md`, each day has a log in `logs/`, and `UNLEARNED.md` is the
one-page note on what changed in how I work.

## Running it

You need Node 22.12 or newer (`.nvmrc` pins 24).

```bash
npm install
npm run dev
```

Open http://localhost:3000, click "Load sample", then "Sort and draft". Type your
name in "Sign replies as", then go through the cards: edit, approve, or choose
"Don't reply". Export the approved replies as CSV or JSON.

It works without any API key, using keyword rules and template replies. For the
AI mode, copy `.env.example` to `.env.local` and add a free Groq key
(console.groq.com). A Gemini key (aistudio.google.com) works too, and is used
as the backup when both are set.

## How it works

```
paste / upload  ->  /api/classify  ->  /api/draft  ->  review in the browser  ->  export
(JSON, CSV, text)   sort into 8      reply drafts,    edit, approve,             CSV / JSON
                    groups + flags   then a second    "don't reply"
                                     model reviews
```

- **Sorting** (`lib/classify-llm.ts`): the model picks one of 8 groups with a
  confidence. Flags are set in code, never by the model alone:
  `possible_injection`, `needs_human` (salary/offer and withdrawals, if either the
  model or the keyword rules say so), `low_confidence`. Messages that look like
  injection attempts are sorted one at a time, so they can't steer the others.
- **Drafting** (`lib/draft.ts`): injection-flagged messages never go to a model;
  a person writes those replies. Every other draft goes through two checks:
  1. Code rules (`lib/guardrails.ts`), re-run on every keystroke. Approve is
     locked if a draft mentions pay, sounds like an offer or a hiring decision,
     names a day or time, claims something was already done, states a company
     policy, has a link or email, contains invisible or look-alike characters,
     talks about being an AI, is over 120 words, or still has a [PLACEHOLDER].
  2. A second model (`lib/critic.ts`) reads each draft for the same risks by
     meaning. It prefers a different model from the one that wrote the draft.
  3. A copied-text check (`lib/echo.ts`), no model involved: if a draft repeats
     a code, a shouted word or a quoted phrase from the candidate's message,
     which is what injection attempts ask for, it's flagged.

  Notes from checks 2 and 3 must be ticked as checked before Approve unlocks, and
  a tick only covers the warnings that were shown when you ticked.
- **Without a key, or if a model fails**, sorting falls back to keyword rules
  and drafting to templates, per batch, with a visible warning.
- **Providers** (`lib/llm.ts`): Groq first, Gemini as failover. Plain `fetch`,
  JSON mode, temperature 0, a cap on output tokens, and a time budget per
  request so every API call answers inside Vercel's 60 second limit.

## Configuration

All settings come from environment variables, are optional, and are validated at
startup (`lib/server-config.ts`). `.env.example` lists every one with its
default. Sizes and thresholds that the code relies on together (batch sizes,
request limits, the confidence threshold) are named constants in
`lib/limits.ts`, with a test that keeps them consistent.

## Security

- API keys are read on the server only. Browser code can't import server
  modules; ESLint enforces it (`eslint.config.mjs`).
- The API only accepts `application/json` from the app's own origin, caps the
  request body, validates every field, and rate-limits per client address,
  counted in messages. The limiter is in memory per server instance, so for
  real protection add a rate-limit rule for `/api/*` in the Vercel Firewall.
- Pages get a per-request nonce Content-Security-Policy (`middleware.ts`), and
  every response gets `nosniff`, `X-Frame-Options: DENY`, a referrer policy
  and a permissions policy (`next.config.ts`).
- Provider error bodies (which include account ids) never reach the browser,
  and server logs record the kind of failure, not message content.
- CSV export defuses cells that a spreadsheet would run as formulas.
- Review work is saved only in your browser, validated on load, and deleted
  after 7 days or when you click "Start over".

**Privacy:** in AI mode, message subjects and bodies (first 2,000 characters)
are sent to Groq, and to Google if Gemini is used. Free tiers have weaker data
terms; Google's terms for unpaid Gemini use allow inputs to be used to improve
its products. Use paid tiers with a data processing agreement before putting
real candidate data through it. Keyword mode sends nothing anywhere.

## Checks

```bash
npm test                 # 254 unit tests; never touch the network
npm run typecheck
npm run lint
npm run redteam          # guardrail, CSV and "fully obedient model" attacks; fails on any change
npm run build
```

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request,
then starts the built app with no API key and checks the endpoints, the 415 and
403 protections and the security headers. A second job fails on production
dependency advisories. Dependabot proposes updates weekly.

Known dependency note: `npm audit` without `--omit=dev` reports `braces`
(through the Next.js ESLint plugin). It is only used by lint tooling on our own
files, never shipped, and has no patched version yet.

## Evals (need an API key, and spend free-tier tokens)

```bash
npm run eval                                   # keyword classifier, sample set
npm run eval -- --llm                          # LLM, active prompt, sample set
npm run eval -- --llm --data data/holdout.json # held-out set: report these numbers
npm run eval -- --llm --provider gemini        # a specific provider
npm run eval:drafts -- --from evals/results/<run>.json
npm run eval:critic                            # the AI reviewer on red-team and real drafts
npm run redteam -- --llm                       # hostile messages through the whole pipeline
npm run check:provider -- groq                 # two real messages, to check a key
npm run label -- data/holdout.json             # review labels by hand
```

`data/sample-inbox.json` (60 messages) is for iterating. `data/holdout.json` (30)
is never tuned against. All 90 labels were checked by hand. Each run is saved to
`evals/results/` with one line in `evals/history.csv`. A run where the model
failed and keywords stood in is marked invalid and left out. Besides accuracy,
the evals report "confident mistakes": wrong answers with confidence of 0.5 or
more, which would not be flagged for review.

## Where it stands

Sorting accuracy:

| | Sample set (60) | Held-out (30, never tuned on) |
|---|---|---|
| Keywords | 75.0% | 26.7% |
| Groq gpt-oss-120b, prompt v1 | 95.0% mean of 4 runs | 86.0% mean of 5 runs (80.0 to 90.0) |
| Gemini 3.5 Flash-Lite, prompt v1 | 94.4% mean of 3 runs | 81.1% mean of 3 runs |

With 30 held-out messages each one is worth 3.3 points, so read these as "mid
80s", not as precise numbers.

Drafting: draft prompt v2 gets 5 of 58 drafts blocked by the code rules (v1:
10 to 12).

Red-team (`data/redteam.json`):

| Layer | Result |
|---|---|
| Hostile messages through the whole pipeline (17) | Groq 16 of 17, Gemini 17 of 17 |
| Code alone, if the model obeyed every attacker (13) | 12 of 13 |
| Draft attacks on the code rules (28) | 17 of 28; the AI reviewer stopped all 28 (Day 4) |
| CSV formula injection (4) | 4 of 4 |

Until Day 5 the pipeline result was reported as "12 of 12". That was only true on
Gemini: on Groq, the model the live site uses first, one attack got through. I
found it by testing the live site by hand; `logs/day5.md` has how, and what
changed.

Known gaps:

- The model is sometimes confidently wrong: 3 to 6 of the 30 held-out messages
  per run, so between 1 in 10 and 1 in 5. Every reply is still reviewed, but a wrong group may not get the
  extra attention it needs.
- The AI reviewer raises a false alarm on about 1 in 10 good drafts.
- Nothing in code stops one candidate's details from appearing in another's
  reply; only the model refusing does (red-team r08).
- Every attack round was written by the same agent that wrote the fixes. An
  independent red-team would be the next real test.
- Free tiers allow 200,000 tokens a day (Groq) shared by everyone using the
  site; a 60-message inbox takes one to two minutes in AI mode.
- One message gets one group. No thread context, so "Ok that works for me"
  can't be placed reliably.
- Review work lives in one browser. There are no accounts and no shared history,
  on purpose: that would mean storing candidate data on a server.

## Project layout

```
app/            page, layout, API routes (classify, draft, config)
components/     Composer, Results, MessageCard, DraftEditor, header, controls
hooks/          useSortAndDraft: the run loop, cancellable, keeps partial results
lib/            pipeline, guardrails, reviewer, providers, config and limits
lib/client/     browser-only helpers: API client, storage, download
middleware.ts   Content-Security-Policy with a per-request nonce
prompts/        versioned prompt files, never edited once used
data/           sample-inbox, holdout and redteam sets
scripts/        evals, red-team, labeling, provider check
tests/          Vitest
evals/          saved runs and history
logs/           one log per day
```
