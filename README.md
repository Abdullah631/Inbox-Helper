# Inbox Helper

You paste in a batch of candidate messages. It groups them by what each person
is asking for, flags the ones that need a careful answer, and drafts a reply for
each one. You edit and approve every reply, then export the approved ones.
Nothing is sent automatically.

I'm building this over 5 days with AI as my main way of working. The plan is in
`intent.md`, the instructions I give the coding agent are in `directive.md`, and
each day has a log in `logs/`.

## Running it

You need Node 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000, click "Load sample", then "Sort and draft". Type your
name in "Sign replies as", then go through the cards: edit, approve or choose
"Don't reply". Export the approved replies as CSV or JSON at the top.

It works without an API key. In that case it uses a simple keyword classifier.

To use the AI classifier, copy `.env.example` to `.env.local` and add a free
Groq key (console.groq.com). A Gemini key works too. Then pick "Auto" or "AI"
in the Classifier switch.

## Tests and evals

```bash
npm test                                # unit tests, no network needed
npm run typecheck
npm run eval                            # keyword classifier vs. the labeled sample set
npm run eval -- --llm                   # LLM with the active prompt (needs a key)
npm run eval -- --llm --prompt v2       # LLM with a specific prompt version
npm run eval:drafts -- --from evals/results/<run>.json   # drafts on a saved classification
npm run eval -- --llm --data data/holdout.json   # the held-out set (report these numbers)
npm run eval:critic -- --provider gemini          # the AI reviewer on red-team and real drafts
npm run redteam                         # guardrail and CSV attacks (add --llm for message attacks)
npx tsx scripts/check-provider.ts groq  # two real messages through one provider
```

`data/sample-inbox.json` is for iterating. `data/holdout.json` is never tuned
against, so its numbers are the honest ones. Any run where the model failed and
keywords stood in is marked invalid and left out of the history.

Every run is saved to `evals/results/` and gets one line in `evals/history.csv`
(or `evals/drafts-history.csv`). The draft eval also writes
`evals/results/drafts-latest.md` so you can read every draft.
Besides accuracy it reports "confident mistakes": wrong answers with confidence
of 0.5 or more, which would not get flagged for review.

## What you can paste in

- JSON: an array like `[{ "id": "m1", "from": "a@b.com", "subject": "Hi", "body": "Any update?" }]`.
  Only `body` is required.
- CSV: needs a header row with a `body` column. Quoted fields and line breaks
  inside quotes are fine.
- Plain text: put a line with `---` between messages.

## Guardrails on drafts

Every draft goes through two checks before it can be approved.

1. Code rules (`lib/guardrails.ts`), run again on every edit. Approve is locked
   if a draft mentions a pay figure, sounds like an offer or a hiring decision,
   names a day, date or time, claims something was already done, states a
   company policy, has a link or email address, contains invisible or
   look-alike characters, talks about being an AI, runs over 120 words, or
   still has a [PLACEHOLDER] in it.
2. An AI reviewer (`lib/critic.ts`): a second model reads every AI draft and
   lists risks by meaning, which catches phrasings the code rules miss. Its
   notes have to be ticked as checked before Approve unlocks. It's wrong about
   1 time in 10, so it doesn't hard-block.

Messages flagged as injection attempts never go to the model for a draft. A
person writes that reply.

## Groups and flags

The 8 groups are scheduling, status_check, offer_compensation, withdrawal,
documents, referral, question and other.

Each message can also get flags:

- `possible_injection`: the message looks like it's trying to give orders to the AI.
- `needs_human`: always set for salary/offer, withdrawals and injection attempts.
- `low_confidence`: the classifier isn't sure.
- `intent_disputed`: while drafting, the model read the message as a different
  group. You can move it or keep it. It can never move a message out of a group
  that needs a person.

## Project layout

```
app/            the page, /api/classify, /api/draft and /api/config
components/     header, theme toggle, segmented control, message card with reply editor
lib/            the logic: classifiers, drafting, guardrails, templates, review helpers, scoring
prompts/        classify.v1-2, draft.v1-2, critic.v1-2 (never edited once used)
data/           sample-inbox.json (60), holdout.json (30, never tuned on), redteam.json
scripts/        evals, red-team, provider check
evals/results/  saved eval runs
tests/          unit tests
logs/           one log per day
```

## Deploying to Vercel (free)

1. Push the repo to GitHub.
2. On vercel.com, choose Add New Project, import the repo and deploy. The defaults work.
3. Add `GROQ_API_KEY` and `GEMINI_API_KEY` in Settings, Environment Variables,
   then redeploy. Groq is used first; Gemini takes over if Groq fails. Without
   either, the live site runs in keyword mode.
4. Recommended: add a rate-limit rule for `/api/*` in the Vercel Firewall. The
   app's own per-IP limit only counts requests on one server instance.

Live URL: https://inbox-helper-alpha.vercel.app

## Where it stands

Sorting accuracy (mean of 3 runs unless noted):

| | Sample set (60) | Held-out (30, never tuned on) |
|---|---|---|
| Keywords | 75.0% | 26.7% |
| Groq gpt-oss-120b, prompt v1 | 94.4% | 83.3% (1 valid run) |
| Gemini 3.5 Flash-Lite, prompt v1 | 94.4% | 81.1% |

Drafting:

| | Drafts blocked by code rules (of 58) | Confident sorting mistakes caught |
|---|---|---|
| Draft prompt v1 | 10 to 12 | 0 of 3 |
| Draft prompt v2 (active) | 5 | 0 or 1 of 3 |

Red-team: the model stopped 12 of 12 hostile messages. The code rules stop all
15 first-round attacks they were fixed against, but only 2 of 13 second-round
ones. The AI reviewer caught all 28. The CSV export defuses formula injection.

All labels were drafted by AI and haven't been checked by a person yet, so
treat every number here with some suspicion.

Known gaps:

- The LLM is sometimes confidently wrong (about 1 in 6 on held-out messages),
  and nothing reliably catches that yet. Every reply is still reviewed.
- The AI reviewer raises a false alarm on about 1 in 10 good drafts.
- Groq's free tier allows 200,000 tokens a day for this model, shared between
  the live site and my evals. When it runs out, Gemini takes over.
- The per-IP rate limit is in memory, so it only slows down one script.
- One message gets one group. No thread context.
