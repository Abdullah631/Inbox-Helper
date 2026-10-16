# What I unlearned

Five days, one tool, AI as the main way of working. These are the habits I came
in with and what replaced them. Each one has a moment in the logs where the old
habit would have cost me.

## Writing the code myself

I used to start by opening an editor and scaffolding by hand. On Day 1 I didn't
write a line. I described what I wanted, read what came back, and decided what
to keep. My job moved from typing to judging. That turned out to be harder,
because judging means I have to know what good looks like before I see it.

## One good number

On Day 2, prompt v2 scored 96.7%. I'd have shipped it. The next run scored 91.7%,
and over three runs it was no better than v1. Now every comparison is at least
three runs, and the spread matters as much as the average.

## Numbers from data I'd already seen

All my early numbers came from the same 60 messages I was tuning on. On Day 4 a
held-out set took the keyword rules from 75% to 27% in one run. Now there are
two sets: one for iterating, one I never touch for anything but reporting.

## Accuracy as the goal

The AI got 94% where keywords got 75%, but it was 95% sure when it was wrong,
and the keyword rules usually knew when they were guessing. For a tool where a
person reviews the risky messages, "confidently wrong" is worse than "often
unsure". I added a metric for it on Day 2 and it's still the target I haven't met.

## "It's configured" means "it works"

Two model names from memory had been retired. A backup provider with a valid key
took a minute to fail. Now every external dependency gets one real request before
I trust it.

## Reading scores instead of outputs

Every real fix on Day 3 came from reading the drafts one by one: replies saying
"I've cancelled your interview" when nothing had been cancelled, invented company
policies, a curly apostrophe getting "You're hired" past a check. No metric showed
any of that until I wrote one for it.

## "Fixed" as the end of a bug

On Day 4 I fixed all 15 ways I'd found to get past the guardrails, then wrote 13
new ones without looking at the fixes. 11 got through. Patching patterns only
covers what I've already imagined. That's why there's now a second model reading
every draft, and a red-team that fails CI if anything changes.

## A second opinion from the same model

I expected the drafting step to catch the classifier's mistakes. Shown the answer,
it agreed every time. With the answer hidden, it repeated the same mistakes,
because it's the same model reading the same words. Independent checks need a
different model, or code.

## My own tests as proof

On Day 5, three independent reviews read everything. They found a blank results
page, a page that could crash on every visit, and a way for any website to spend
my token budget, after four days of green tests. Two of my tests had been written
to expect the buggy behavior. My test suite only checks what I already thought
of, so now it's the first reviewer, not the last.

The last gap of the week came after all of that. Every report was green. Then I
uploaded the attack file into the live site and read the cards myself, and one
message got its code word into my reply. The automated red-team had only ever
run on the backup model. Green reports aren't the same as having used the thing.

## What I'd tell the next person

Measure before you believe, measure on data you haven't touched, read what the
model actually wrote, and get someone (or something) that isn't you to try to
break it. Most of what made this week useful came from being wrong in public, in
the logs, and fixing it there.
