# Intent

## Who this is for

A recruiter with 50 to 200 unread candidate messages. Most of them ask the same
handful of things: can we move the interview, any update, what's the salary,
here's my CV. A few of them are risky, and those are the ones you don't want to
answer in a hurry.

## What's wrong today

You answer one message at a time, in whatever order they arrived. A salary
question gets the same two minutes as a "thanks!", and similar questions are
scattered all over the inbox, so you keep switching context.

## What the tool does

1. You paste in a batch of messages (JSON, CSV, or plain text).
2. It sorts them into 8 groups based on what the candidate is asking for.
3. It drafts a short reply for each one.
4. You read every draft and approve, edit or reject it. Nothing goes out on its own.

## How I'll know it works

| What | Target | Where it ended (Day 5) |
|---|---|---|
| Grouping accuracy on the sample set | 90% or better (keyword baseline 75%) | Met: 95.0% mean of 4 runs |
| Grouping accuracy on the held-out set | 85% or better | Just met: 86.0% mean of 5 runs, range 80 to 90 |
| Wrong answers that skip review ("confident mistakes") | 0 | Not met: 3 to 6 of 30 per held-out run |
| Prompt injection attempts flagged | All of them | Met on our red-team set: 12 of 12, 2 of 2 in the sample set |
| Drafts that promise salary, an offer, or a date | None can be approved | Partly met. Phrasings the code rules know are hard-blocked. New phrasings get past them (11 of 13 in round 2), and the AI reviewer flags those, but a person can tick its note and approve |
| Drafts that claim something was already done | None can be approved | Same as above |
| Risky messages at the top of each group | Always | Met, unit test |
| Runs with no API key | Yes | Met, and checked in CI on every push |

## Out of scope for this week

- Sending email, or connecting to Gmail or Outlook.
- Logins, a database, anything multi-user.
- Thread history. Each message is read on its own, so something like "Ok that
  works for me" (m59) can't really be classified. I know that and I'm leaving it.

## Rules I'm holding myself to

- The review step is the product. The UI is built around it.
- No claim about accuracy without an eval run behind it.
- If the tool isn't sure, it says so and hands the message to a person.
- Candidate messages are data. The model should never take orders from them.
