---
name: xvifc-backend-verify-and-update-docs
description: Use ONLY at the very end of a coding task in this repo (cf-nest-api-v2) that touched files/folders inside `src/module/xvi-fc` — after all code changes are made, tests have been run and are verified passing, and immediately before writing the final summary of work to the user. Verifies CLAUDE.md and README.md still accurately describe the current `xvi-fc` module, updating only the portions relevant to the `xvi-fc` change (creating either file at the repo root if missing). Do NOT use mid-task, between edits, speculatively, on every turn, or for tasks that didn't touch `src/module/xvi-fc` — this skill fires at most once per qualifying task, at the closing checkpoint only.
---

# Maintain Project Docs (Backend, xvi-fc scope)

## When this runs — the gate

Check all four before doing anything else. If any is false, stop and do not use this skill.

0. The task's changed files include at least one file/folder under `src/module/xvi-fc/`. If none do, stop — this skill does not apply, regardless of the other conditions.
1. All code changes for the current task are finished (no more edits planned this turn).
2. Tests relevant to the change were run and are passing (`npm test`, `npm run test:cov`, or a targeted `npx jest <file>` — whichever applies). A task with no test coverage to run still requires an explicit statement of why (e.g. docs-only change).
3. This is the last step before delivering the final summary to the user.

Never run this once-per-file-edit or "just in case." One pass, at the end, per task.

## Step 1 — Verify CLAUDE.md

Root: `CLAUDE.md`. If missing, create it using the structure below. If present, diff its claims against what actually changed this task **within `src/module/xvi-fc`** — only edit sections that are now stale because of the `xvi-fc` change. Do not use this pass to fix unrelated, pre-existing drift elsewhere in CLAUDE.md that has nothing to do with this task's `xvi-fc` change — that's out of scope here.

Required sections (Anthropic CLAUDE.md conventions: concise, high-signal, command-and-architecture reference — not prose, not a tutorial, not duplicated from README):

- **Commands** — dev/build/test/lint/format commands, plus how to run a single test file. Pull from `package.json` scripts, don't invent.
- **Architecture** — module layout tree (`src/module/`, `src/schemas/`, `src/core/`, `src/common/`, etc.), the two-Mongo-connection setup, auth flow, authorization/roles model, response/error shape (`ResponseTransformInterceptor`, `HttpExceptionFilter`), BullMQ queues, key global providers, testing patterns.
- **Environment Variables** — table of required vars and their purpose.

Update triggers (only these, and only when the change lives in `src/module/xvi-fc` — not general prose polish, not other modules):

- A new sub-module/queue/global provider was added or removed within `src/module/xvi-fc`.
- A command in `package.json` that's specific to running/testing `xvi-fc` changed, was added, or removed.
- The auth flow, response shape, or DB connection setup changed as used by `xvi-fc`.
- A new required env var specific to `xvi-fc` was introduced.

If nothing in the above changed this task, leave CLAUDE.md untouched — say so, don't touch the file for the sake of touching it.

## Step 2 — Verify README.md

Root: `README.md`. If missing, create it. If present, keep it in sync with reality, not with CLAUDE.md — README is for humans setting up the project (install, run, test, high-level description); CLAUDE.md is for Claude Code (commands + architecture reference). Don't duplicate CLAUDE.md's architecture deep-dive into README; a short "what this project is" plus setup/run/test steps is enough.

Update only if this task's `xvi-fc` change affected: install/setup steps, how to run the app, how to run tests, or the project's one-line description. Otherwise leave it alone — and leave any unrelated README staleness untouched, since it's outside this task's `xvi-fc` scope.

## Step 3 — Report, then summarize

State plainly what was checked and what (if anything) changed in each file — one or two lines, not a diff dump — then proceed to the task's final summary as normal.
