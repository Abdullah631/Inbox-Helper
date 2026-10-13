# Inbox Helper

You paste in a batch of candidate messages. It groups them by what each person
is asking for and flags the ones that need a careful answer. From Day 3 it also
drafts a reply for each one. Every draft has to be approved by a person; nothing
is sent automatically.

I'm building this over 5 days with AI as my main way of working. The plan is in
`intent.md`, the instructions I give the coding agent are in `directive.md`, and
each day has a log in `logs/`.

## Running it

You need Node 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000, click "Load sample", then "Sort messages".

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
```

Every run is saved to `evals/results/` and gets one line in `evals/history.csv`.
Besides accuracy it reports "confident mistakes": wrong answers with confidence
of 0.5 or more, which would not get flagged for review.

## What you can paste in

- JSON: an array like `[{ "id": "m1", "from": "a@b.com", "subject": "Hi", "body": "Any update?" }]`.
  Only `body` is required.
- CSV: needs a header row with a `body` column. Quoted fields and line breaks
  inside quotes are fine.
- Plain text: put a line with `---` between messages.

## Groups and flags

The 8 groups are scheduling, status_check, offer_compensation, withdrawal,
documents, referral, question and other.

Each message can also get flags:

- `possible_injection`: the message looks like it's trying to give orders to the AI.
- `needs_human`: always set for salary/offer, withdrawals and injection attempts.
- `low_confidence`: the classifier isn't sure.

## Project layout

```
app/            the page, /api/classify and /api/config
components/     header, theme toggle, segmented control, message card
lib/            the logic: schema, intents, flags, keyword and LLM classifiers, parser, grouping, scoring
prompts/        classify.v1.md, classify.v2.md (never edited once used)
data/           sample-inbox.json, 60 labeled messages
scripts/        run-eval.ts
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

| | Accuracy | Confident mistakes | Notes |
|---|---|---|---|
| Keywords (Day 1) | 75% | 4 | Wrong often, but usually unsure when wrong |
| LLM, prompt v1 (Day 2, active) | 94.4% mean of 3 runs | 3 every run | gpt-oss-120b on Groq |
| LLM, prompt v2 (Day 2) | 94.4% mean of 3 runs | 2 to 5 | More variance, not adopted |

The labels were drafted by AI and I haven't checked them all yet, so treat these
numbers with some suspicion. They're also all on the same 60 messages.

Known gaps:

- The LLM is sometimes confidently wrong, so its confidence alone can't decide
  what skips review. This is the open problem going into Day 3.
- Free tier rate limits can push a request past Vercel's 60 second limit on a
  big inbox. Not load tested yet.
- The keyword rules only understand English, so the Spanish message (m56) is
  misclassified in keyword mode.
- One message gets one group. m53 asks two things and only one gets picked up.
- No thread context. "Ok that works for me" can't be placed without knowing what came before it.
