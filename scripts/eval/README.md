# Agent prompt evals

A/B tests measuring whether the prompts in `.claude/agents/` actually change an
agent's behaviour, rather than just reading well.

## Method

Identical model (`claude-sonnet-4-6`), identical task, identical fixture. The
only variable is whether the agent reads the prompt first. Fixtures contain no
answer key: a first attempt embedded the defect list in a comment, both arms read
it despite instructions, and both scored well for the wrong reason. That run was
discarded.

## Results

| Agent | control | with prompt | fixture |
|---|---|---|---|
| `backend` | 1/6 (+1 partial) | **6/6** | `reports-module.sql` |
| `testing` | 3/7 | **7/7** | `reports-tests.mjs` |
| `frontend` | 4/6 | **6/6** | `reports-page.tsx.txt` |

All three were re-run after commit `c597466` edited every prompt, because the
original numbers described file versions that no longer existed. Scores held.
See `grade-rerun-after-edit.cjs`.

## What each result actually shows

- **backend** is the strongest margin. The unprimed control missed four
  repo-specific rules outright, and on the fifth it *raised* the missing
  `WITH CHECK` then talked itself out of it: "WITH CHECK ... defaults to the
  USING expression anyway, so that might actually be fine". That is precisely
  the reasoning that shipped the original vulnerability.
- **testing** produced the same count from both arms (8 problems each), so the
  count was uninformative. The content differed: only the primed agent
  identified that a `SELECT`-only grant makes the denial test pass for the wrong
  reason.
- **frontend** is the weakest margin, and the most useful. Generic React
  knowledge already covers most of that file; the prompt's entire contribution
  was two repo-specific rules. It also exposed a real defect: the primed agent
  scored 6/6 while *missing* two unseeded bugs the control found. That is why
  every prompt now carries a "Do not stop at the checklist" section, and after
  that edit the frontend agent finds both.

## Honest limits

- n=1 per arm, one model, one task per agent.
- I wrote both the prompts and the answer keys.
- Three agents (`debugging`, `pipeline`, `uxui`) have **no** behavioural
  evidence, before or after the edit. What is verified for them is that they
  parse and that every concrete reference they make resolves
  (`scripts/check-agent-references.cjs`, enforced in CI). That is accuracy, not
  effectiveness. Do not read "verified" as "tested".
- On the testing eval the control found one issue the primed agent missed (the
  JWT claim not being reset between role switches), so the prompts are not
  strictly dominant.

This is directional evidence, not a benchmark.
