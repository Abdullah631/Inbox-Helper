# Day 5

## What I set out to do

Treat the whole project as if someone else had written it and I had to sign off
on it. Every file, every setting, as a security analyst, a senior engineer and a
QA lead would. Fix what's wrong, make every hardcoded value configurable or at
least named, and set up CI so the checks run on every push. Then write the final
directive, this log and the unlearning note.

## Load added today

The biggest change of the week, on the last day: about 70 files touched or added,
an API layer rewritten, the page split into a reducer, hooks and components, and
a CI pipeline from nothing. All while keeping the live site working.

## Prompts used

1. "the changes have been pushed and now we will proceed with extreme measure to
   evaluate to perfect the code from step 1 till completion and we'll evaluate
   every line of code every file every setting we have done we'll see hardcoded
   things and make sure everything becomes dynamic ... critically evaluate as
   senior QA, cyber security analyst, senior software engineer ... along with day
   5 work"


## How I worked

Claude Code started three independent reviewers in parallel: security and cloud,
engineering and design, QA and CI. Each read every file and reported findings
with file and line. None of them changed anything. Then every finding was checked
before any fix: reproduced with a small script, timed, or tried against the live
site. Only then did the fixing start, in order: config, AI layer, API boundary,
parser, frontend, CI, docs.

## What the reviews found, and what happened to each

Security:

- **Any website could spend our tokens through its visitors' browsers.**
  Confirmed against the live site. The API accepted a `text/plain` POST from any
  origin, which browsers send without a preflight, and each visitor's own IP
  meant the rate limit didn't help. Fixed: the API only takes
  `application/json` and rejects other origins (415 and 403). A test breaks the
  check on purpose to make sure the test notices.
- **One request could trigger about 20 model calls with no cap on output.**
  About 8 requests would use up a day's quota. Fixed: requests are capped at
  what the UI sends (20 to sort, 10 to draft), every call has a token cap, and
  rate limits count messages instead of requests.
- **No security headers.** Fixed: a per-request nonce Content-Security-Policy
  (so the inline theme script still runs), frame denial, nosniff, referrer and
  permissions policies. Checked in a browser in production and dev mode: no
  violations.
- **One message could steer how others in its batch were sorted**, which could
  drop a salary question's "needs a person" flag. Fixed two ways: messages that
  look like injection are sorted on their own, and "needs a person" is set if
  either the model or the keyword rules think it's about salary or a withdrawal.
- **Drafts could steer the AI reviewer.** Fixed: reviewer batches went from 15
  to 5, and a code check flags any draft that talks to "the reviewer".
- **The draft route trusted the browser's injection flag.** A direct API caller
  could drop it. Fixed: the server checks again.
- **Two regexes slowed down badly on hostile input.** Confirmed: the keyword rules
  took 3.2 seconds on 50 long messages, now 17 ms with the same accuracy (75.0%
  and 26.7%). The parser froze the browser for 3.6 seconds on a paste of blank
  lines, now instant.
- **Our Groq organization id was in three committed eval files.** Redacted in
  the files. It's still in git history; rewriting history needs a force push,
  and I haven't decided to do that.
- **Review data stayed in the browser forever.** Now 7 days, with a button to
  delete it.
- **A PostCSS advisory in production dependencies.** Not exploitable here (it's
  about processing untrusted CSS at build time), but fixed with an npm override
  to the patched version. `npm audit --omit=dev` now reports 0. The dev-only
  `braces` advisory has no patched version and stays, documented in the README.

Engineering:

- **Duplicate ids left a blank results page after a full paid run.** Confirmed.
  Fixed in the parser: made-up ids can't collide with real ones, and a repeated
  id is kept once with a clear message.
- **A corrupted saved session crashed the page on every visit.** Fixed: the
  session is fully validated on load and deleted if it's bad. Tested in a real
  browser with a deliberately broken session.
- **The retry budget could run past Vercel's 60 second limit** before failover
  ever ran. Fixed: each request has a 50 second budget passed down to every model
  call, and when a backup exists the first provider fails over at once instead
  of retrying.
- **Moving a message while its draft was being written** could be overwritten by
  the late draft. Fixed: all review state moved into a pure reducer that knows
  which group each draft was requested for, and Move is disabled during a run.
- **Hardcoded values everywhere.** Now named constants in `lib/limits.ts` with a
  test that checks the ones that depend on each other, and a validated env config
  in `lib/server-config.ts` documented in `.env.example`.
- **The same code three times.** "Ask for JSON, check it, retry with the error"
  was copied into the classifier, drafting and the reviewer. Each script loaded
  env and read arguments its own way. Now one helper each.
- **The page was 482 lines.** Now a reducer, a run hook and five components, with
  memoized cards so typing in one reply doesn't re-check all 60.
- Smaller ones, all fixed: "[URGENT] can we move..." was read as broken JSON; a
  message starting with "Body" was read as CSV; a header-only CSV gave no error;
  a provider sending a non-JSON 200 skipped failover; one failed reviewer batch
  wiped every draft's notes; the reviewer eval measured the wrong prompt version
  by default; Unicode tag characters slipped past the guardrails.

QA:

- **Tests could make real API calls** if a key was set in the shell. Fixed: a
  setup file clears keys and makes any network call fail the test.
- **No tests for the API routes.** Now 13, sending real requests to the handlers.
- **The README said Node 20.** Vitest needs 22.12. Fixed, and `.nvmrc` pins 24.
- **No CI.** Now GitHub Actions: typecheck, lint, tests, the red-team gate, build,
  then a smoke test of the built app with no key that also checks the 415, 403
  and security headers. A second job fails on production advisories. Dependabot
  is on. I ran every smoke-test command locally first; it hasn't run on GitHub yet.
- **The red-team script always exited 0**, so it couldn't gate anything. Now it
  compares against recorded known misses and fails on any change in either direction.

## Numbers after the rebuild

| Check | Result |
|---|---|
| Unit tests | 226, up from 162 |
| Held-out set, Groq, prompt v1 | 90.0% (1 run on the new code; 5-run mean is 86.0%) |
| Sample set, Groq, prompt v1 | 96.7% (1 run on the new code; 4-run mean is 95.0%) |
| Pipeline red-team (12 hostile messages, Gemini) | 12 of 12 stopped |
| Guardrail red-team | 17 of 28 by code rules, same as Day 4; 0 surprises |
| Production dependency advisories | 0 |
| Browser check, keyword and AI mode | No console errors, no CSP violations |

The single runs on the new code are within the range of earlier runs. I'm
calling that "no regression", not an improvement.

## What went wrong today

- Several old tests had encoded the bugs. One expected duplicate ids to be kept
  (the cause of the blank page), another expected raw error text to reach the
  user (the leak the security review flagged). The suite was green and was
  certifying wrong behavior.
- My first eval run after the rebuild was invalid. I had cut the app's longest
  retry wait to 10 seconds to stay inside Vercel's limit, and back-to-back eval
  runs then hit Groq's per-minute limit. The invalid-run guard from Day 4 caught
  it. Scripts now get longer waits than the app.
- "Sorted by" showed only the last request's model. When Groq ran out partway
  and Gemini took over, the label hid one of them. Found in a screenshot, fixed.
- Dev mode showed a hydration warning, because browsers hide the nonce attribute
  after load. Expected for nonces, now suppressed on that one tag.
- I made mistakes in my own new tests three times: a test address with a
  one-letter name the name guesser rightly refused, a wrong assumption about how
  many calls a failed batch makes, and a JSON detection rule that rejected `[1]`.
  Each one showed up as a failing test, not in production.
- My first Stop-button test didn't test anything: keyword mode finished before
  the click. Re-ran it in AI mode, where it worked.
- The page is now rendered per request (the nonce needs it), so it can't be
  served as a static file any more. A small cost for the CSP.

## Not done

- Rewriting git history to remove the org id. It needs a force push.
- The Vercel Firewall rate-limit rule. It's a dashboard setting; the in-app limit
  is per instance and only slows a single script down.
- Browser tests in the repo. The browser checks this week ran from scratch
  scripts, not from CI. Playwright would be the next step.
- Next.js 16. The PostCSS fix went in as an override instead of a major upgrade.
- Several groups per message, and thread context. Still known gaps.

## Habit I dropped today

Trusting my own tests as proof. Four days of green tests, and three independent
reviews still found a blank results page, a page that could crash on every visit
and a way for any website to spend my token budget. Two of my tests had been
written to expect the buggy behavior. I now treat my own test suite as the
weakest reviewer, because it only checks what I already thought of.

## What surprised me

That the most serious problem was the simplest one. Not prompt injection or model
behavior, but a missing content-type check that let any website use my API
through its visitors' browsers. I'd spent days hardening the AI layer and hadn't
looked at the plain HTTP boundary at all.
