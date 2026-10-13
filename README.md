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
npx tsx scripts/check-provider.ts groq  # two real messages through one provider
```

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

Every draft is checked in code before it can be approved, and again on every
edit (`lib/guardrails.ts`). Approve stays locked if a draft mentions a pay
figure, sounds like an offer or a hiring decision, names a day, date or time,
claims something was already done, states a company policy, talks about being
an AI, runs over 120 words, or still has a [PLACEHOLDER] in it.

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
prompts/        classify.v1-2, draft.v1-2 (never edited once used)
data/           sample-inbox.json, 60 labeled messages
scripts/        run-eval.ts, run-draft-eval.ts, check-provider.ts
evals/results/  saved eval runs
tests/          unit tests
logs/           one log per day
```

## Deploying to Vercel (free)

1. Push the repo to GitHub.
2. On vercel.com, choose Add New Project, import the repo and deploy. The defaults work.
3. Add `GROQ_API_KEY` in Settings, Environment Variables, then redeploy. Without
   it the live site runs in keyword mode.

Live URL: not deployed yet.

## Where it stands

Sorting:

| | Accuracy | Confident mistakes | Notes |
|---|---|---|---|
| Keywords (Day 1) | 75% | 4 | Wrong often, but usually unsure when wrong |
| LLM, prompt v1 (Day 2, active) | 94.4% mean of 3 runs | 3 every run | gpt-oss-120b on Groq |
| LLM, prompt v2 (Day 2) | 94.4% mean of 3 runs | 2 to 5 | More variance, not adopted |

Drafting (Day 3, same 58 drafts each run):

| | Drafts blocked by guardrails | Confident mistakes caught by dispute |
|---|---|---|
| Draft prompt v1 | 10 to 12 | 0 of 3 |
| Draft prompt v2 (active) | 5 every run | 0 or 1 of 3 |

The labels were drafted by AI and I haven't checked them all yet, so treat these
numbers with some suspicion. They're also all on the same 60 messages.

Known gaps:

- The LLM is sometimes confidently wrong, and the dispute check only catches
  that occasionally. A wrong group still gets a reviewed reply, but it may not
  get the extra attention it needs.
- Groq's free tier allows 8,000 tokens a minute. Sorting and drafting 60
  messages takes around two and a half minutes because of that.
- Review progress is lost on refresh.
- The model invents company facts now and then. The guardrail catches the
  common shapes ("we do have a referral program") but not every phrasing.
- The keyword rules only understand English. One message gets one group. No
  thread context, so "Ok that works for me" can't be placed reliably.
