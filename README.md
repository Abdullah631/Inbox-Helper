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

Open http://localhost:3000, click "Load sample inbox", then "Group messages".

It works without an API key. In that case it uses a simple keyword classifier.

## Tests and evals

```bash
npm test            # unit tests
npm run typecheck
npm run eval        # scores the classifier against the labeled sample set
```

Every eval run is saved to `evals/results/` so I can compare runs from day to day.

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
app/            the page and the /api/classify route
lib/            the logic: schema, intents, keyword classifier, parser, grouping, scoring
data/           sample-inbox.json, 60 labeled messages
scripts/        run-eval.ts
evals/results/  saved eval runs
tests/          unit tests
logs/           one log per day
```

## Deploying to Vercel (free)

1. Push the repo to GitHub.
2. On vercel.com, choose Add New Project, import the repo and deploy. The defaults work.
3. From Day 2, add `GROQ_API_KEY` in Settings, Environment Variables.

Live URL: not deployed yet.

## Where it stands

Day 1: the keyword classifier gets 45 of 60 right (75%) and flags both injection
attempts. The labels were drafted by AI and I haven't checked them all yet, so
treat that number with some suspicion.

Known gaps:

- The keyword rules only understand English, so the Spanish message (m56) is misclassified.
- One message gets one group. m53 asks two things and only one of them gets picked up.
- No thread context. "Ok that works for me" can't be placed without knowing what came before it.
