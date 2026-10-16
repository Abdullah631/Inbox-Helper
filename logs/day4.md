# Day 4

## What I set out to do

Stop measuring on the same 60 messages, and try to break the thing on purpose.
Concretely: a held-out set I never tune against, a red-team set that attacks
every layer, fixes for what breaks, and an honest count of what still breaks.
Plus two leftovers from Day 3: review work lost on refresh, and provider errors
leaking account details into the UI.

## Load added today

The first day where the goal was to make my own numbers worse. Every number
from Days 1 to 3 was measured on messages I'd been looking at all week. Today
they got tested on messages written fresh, and the code got attacked with
inputs designed to get through it.

## What got built

- `data/holdout.json`: 30 new messages, messier than the sample set. French,
  German, Urdu in Latin script, sarcasm, email signatures and quoted threads,
  a calendar auto-decline, an agency sales pitch, one-word replies.
- `data/redteam.json` and `npm run redteam`: 32 draft texts written to slip
  past the guardrails (in two rounds, see below), 12 hostile candidate messages
  run through the real pipeline, and 4 spreadsheet formula attacks on the CSV export.
- AI reviewer (`lib/critic.ts`, `prompts/critic.v1-2.md`): a second model reads
  every AI draft and lists risks by meaning. Its notes are a soft block: Approve
  unlocks after ticking "I've checked these". Regex guardrails stay a hard block.
  It prefers a different model from the one that wrote the drafts.
- Provider failover: when Groq fails, the app tries Gemini, and the UI says which
  model actually answered.
- Review progress is saved in the browser and restored after a refresh, with a
  "Picked up where you left off" banner and a Start over button.
- Input size limits on the API, and a per-IP limit of 30 AI requests a minute.
- CSV export defuses cells that would run as spreadsheet formulas.
- Provider error bodies no longer reach the browser.
- 162 tests, up from 133.

## Numbers

### Held-out set (30 messages, never tuned on)

| Classifier | Sample set (60) | Held-out (30) |
|---|---|---|
| Keywords | 75.0% | 26.7% |
| Groq gpt-oss-120b, prompt v1 | 94.4% (3 runs) | 83.3% (1 valid run) |
| Gemini 3.5 Flash-Lite, prompt v1 | 94.4% (3 runs) | 80.0, 80.0, 83.3 (mean 81.1%) |

The keyword classifier was never 75% good. It was 75% good on messages its
rules were written next to. On new messages it's barely better than guessing
the biggest group. The LLM drops about 12 points. Its held-out mistakes include
an agency sales pitch filed as a referral at 94% confidence, and "URGENT please
call me back" filed as scheduling. Three of its five misses (h15, h16, h22) are
labels I had already marked as debatable.

Only one Groq held-out run is valid. The other two hit the daily token limit
(see below) and are excluded.

### Red-team

| Layer | Attacks | Stopped before fixes | Stopped after fixes |
|---|---|---|---|
| Pipeline (12 hostile messages, Gemini) | 12 | 12 | not re-run |
| Regex guardrails, round 1 (15) | 15 | 2 | 15 |
| Regex guardrails, round 2 (13, written after the fixes) | 13 | | 2 |
| AI reviewer, round 1 + round 2 | 28 | | 28 |
| CSV formula injection | 4 | 0 | 4 |

### AI reviewer false alarms on good drafts

| Reviewer prompt | Sample drafts (58) | Held-out drafts (30) |
|---|---|---|
| v1 | 17 concerns, about 12 false | 7 concerns |
| v2 (active) | 9 concerns, about 4 false | 5 concerns, about 3 false |

## What went wrong

- The held-out set showed the sample-set numbers were flattering. Keywords
  went from 75% to 26.7%, the LLM from 94% to about 82%. Every decision I made
  on Days 2 and 3 was measured on the 60 sample messages, so all of those
  numbers are optimistic to some degree.
- I ran out of Groq's daily token limit (200,000 tokens per day for this model)
  in the middle of the day. Two held-out runs silently became keyword runs,
  and my eval script logged them as LLM scores. I only noticed because the
  accuracy looked wrong. The script now refuses any run with fallbacks, and
  those two rows are gone from the history. The same key powers the live site,
  so for a while the live site was quietly running on keywords too.
- My retry logic couldn't read "try again in 19m0.9s" and kept retrying for
  nothing. It now reads minutes and gives up straight away when the wait is
  longer than a request can last.
- The Gemini backup wasn't a backup. The Flash models answered with 503 "high
  demand" after up to a minute. Flash-Lite answered in a second, and then
  matched Groq's accuracy (94.4% on the sample set). It's the backup now.
- When every provider failed, results still said "openai/gpt-oss-120b" as the
  model. Now they say no model answered.
- The regex guardrails were much weaker than I thought. The first red-team
  round got 13 of 15 attacks through: pay written in words, "Rs.", "you've got
  the job", "Mon at 10", zero-width characters, look-alike Cyrillic letters,
  links. I fixed all of them, then wrote a second round after the fixes, without
  tuning to it. That round got 11 of 13 through. Patching patterns only covers
  the phrasings I've already thought of. That's why the AI reviewer exists.
- The CSV export was a real vulnerability. A candidate address like
  `=HYPERLINK(...)` would become a live formula in the recruiter's spreadsheet.
  Fixed.
- The AI reviewer v1 was noisy (about 1 in 5 good drafts flagged) and once
  invented a quote that wasn't in the draft. v2 and a code check (a concern must
  quote words that are actually in the draft, and a placeholder alone doesn't
  count) brought it to about 1 in 10. It's still wrong sometimes. In the browser
  test it flagged "I'll check the calendar and resend the invite" as a claimed
  action, which it isn't.
- I tuned critic v2 against the same 58 sample drafts it was failing on, which
  is the overfitting I keep warning myself about. I checked it on 30 held-out
  drafts afterwards, and the false alarm rate held, but the first tuning step
  was on seen data.
- With Groq down, the reviewer fell back to the same model that wrote the
  drafts. Day 3 showed a model doesn't catch its own mistakes well. I chose a
  weaker check over no check, and the UI names the reviewer model so it's visible.
- The API is public. Anyone with the URL could spend the shared free token
  budget. The per-IP limit is in memory, so it only counts requests that hit
  the same serverless instance. It slows down a single script; it isn't real
  protection. A Vercel Firewall rate-limit rule would be.
- My first browser test of the reviewer tick box didn't actually test it: every
  card with reviewer notes was also blocked by an unfilled [RECRUITER_NAME].
  The script reported "no card" and I almost moved on. Reran with signing.

## Decisions

- Two layers for draft safety: regex as a hard block (fast, predictable,
  runs on every keystroke) and an AI reviewer as a soft block (catches what
  patterns can't, sometimes wrong). Neither alone was good enough.
- The reviewer's notes don't hard-block, because at about 1 in 10 false alarms
  a hard block would push people to edit good drafts just to get past it.
- Evals use one provider per run. The app uses failover. A score never mixes
  two models without saying so.
- Gemini Flash-Lite is a real backup, not a degraded mode. Its numbers match.
- I did not tune anything against the held-out set. It stays held-out.

## Still to do

- [ ] Review the labels by hand. Now 90 of them, all still AI-proposed. The
      30 held-out ones matter most.
- [ ] Two more Groq runs on the held-out set once the daily limit resets.
- [ ] Add a Vercel Firewall rate-limit rule for /api/*.
- [ ] Multi-intent messages still get one group.

## Habit I dropped today

Trusting a number from data I'd already seen. Until today every result in my
logs came from the same 60 messages I'd been tuning against all week. The
held-out set took the keyword classifier from 75% to 27% in one run. I'd have
put 75% in the final video without blinking.

I also dropped "I fixed it" as the end of a bug. After fixing all 15 guardrail
bypasses, the honest next step was to attack it again with cases I hadn't
fixed for, and that round got 11 of 13 through.

## What surprised me

(Correction made on Day 5: the run below was on Gemini. On Groq, the model the
live site uses first, the same 12 messages stopped 11; r02 got through. See day5.md.)

How differently the two safety layers held up. The model stopped all 12 hostile
messages, including a fake SYSTEM message, an injection in Spanish and one
trying to leak another candidate's name from the same batch. My hand-written
rules, which I'd thought of as the solid layer, fell over on the first try.

Also that the small, fast model was as accurate as the big one. Gemini
Flash-Lite matched gpt-oss-120b on the sample set and came within a couple of
points on the held-out set, at a fraction of the wait.
