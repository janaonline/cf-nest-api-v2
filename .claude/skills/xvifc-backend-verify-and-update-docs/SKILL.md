---
name: xvifc-backend-verify-and-update-docs
description: Two modes, both scoped to `src/module/xvi-fc` in this repo (cf-nest-api-v2). Mode A (automatic) — use ONLY at the very end of a coding task that touched files/folders inside `src/module/xvi-fc`, after all code changes are made and tests have been run and verified passing, immediately before writing the final summary to the user. Verifies CLAUDE.md, README.md, and any nested per-feature CLAUDE.md/ADR the task touched still accurately describe reality, updating only what this task's change made stale. Do NOT use mid-task, between edits, speculatively, on every turn, or for tasks that didn't touch `src/module/xvi-fc` — fires at most once per qualifying task, at the closing checkpoint only. Mode B (manual) — use when explicitly asked to audit, clean up, or backfill documentation and comments for one `xvi-fc` sub-feature folder end to end (e.g. "audit comments and docs in the gtc folder", "clean up request-exemption's comments", or invoked directly as `/xvifc-backend-verify-and-update-docs <folder-path>`) — a standalone, whole-folder pass independent of any other task, that creates a missing nested CLAUDE.md/ADR when warranted and rewrites every existing comment in that folder against the shared Comment Style Contract, not just what a recent change touched.
---

# Maintain Project Docs (Backend, xvi-fc scope)

## How to invoke this skill

- **Automatic (Mode A):** fires on its own at the end of a qualifying coding task — no action
  needed most of the time.
- **Manual (Mode B):** run `/xvifc-backend-verify-and-update-docs <folder-path>`, e.g.
  `/xvifc-backend-verify-and-update-docs src/module/xvi-fc/state/gtc`, to run the full
  audit-and-backfill pass on that one folder regardless of whether the current session touched it.
  Plain-language equivalents work too ("audit comments and docs in the gtc folder", "clean up
  request-exemption's comments the way we did before") — the description above matches on intent,
  the folder just needs to be identifiable from the request.

## Comment Style Contract

The rules both modes apply to every comment they touch or write. This is the bar established and
validated (by hand, then reviewed to a 9/9 standard) on `request-exemption` and `gtc` — apply it
the same way here.

- Don't write a comment for the sake of having one.
- Delete or shrink any comment that just restates the function/variable name, its signature/types,
  or the line of code directly below it — that's not a comment, it's noise.
- Keep only a comment that states a genuine _why_: a non-obvious constraint, a workaround, a
  business rule, a reason a reader couldn't get just from reading the code.
- Prefer one line. If the why needs more than a couple of lines, that's a signal it belongs in the
  feature's nested `CLAUDE.md` or a `docs/adr/*.md` file instead — shrink the inline comment to one
  line plus a pointer that names the real section or file (e.g. `see CLAUDE.md's "list() filters
and paginates in memory" section`, or `docs/adr/0002-....md`), never a vague "see docs."
- Once something lives in `CLAUDE.md`/an ADR, don't also restate it inline somewhere else — one
  source of truth per decision, including across sibling modules (a shared decision gets one ADR,
  cited by every module that depends on it, not a copy per module).
- Keep TODO/FIXME markers inline and short (the action item); move the elaboration behind it to
  CLAUDE.md's "Known gaps," not the TODO line itself.
- Never change behavior during either mode's pass — comments and docs only. If a real bug turns up
  while reading, flag it to the user; don't fix it silently as part of a docs/comments task.

## Mode A — End-of-task check (automatic)

### When this runs — the gate

Check all four before doing anything else. If any is false, stop and do not use this skill.

0. The task's changed files include at least one file/folder under `src/module/xvi-fc/`. If none do, stop — this skill does not apply, regardless of the other conditions.
1. All code changes for the current task are finished (no more edits planned this turn).
2. Tests relevant to the change were run and are passing (`npm test`, `npm run test:cov`, or a targeted `npx jest <file>` — whichever applies). A task with no test coverage to run still requires an explicit statement of why (e.g. docs-only change).
3. This is the last step before delivering the final summary to the user.

Never run this once-per-file-edit or "just in case." One pass, at the end, per task.

### Step 1 — Verify CLAUDE.md

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

### Step 2 — Verify feature-level docs (nested CLAUDE.md / docs/adr)

Some `xvi-fc` sub-features maintain their own nested `CLAUDE.md` plus a `docs/adr/*.md` set inside
their own folder (e.g. `src/module/xvi-fc/state/claim-letter/CLAUDE.md` +
`docs/adr/000N-*.md`) — a smaller, colocated version of the root-CLAUDE.md pattern, scoped to that
one feature's design decisions instead of the whole backend.

If this task touched a sub-feature folder that **has** a nested `CLAUDE.md`:

- Check every comment you added or edited in that folder against the Comment Style Contract above.
- If the task's change altered a decision an existing ADR documents (not just touched code near it),
  update that ADR or add a new one that supersedes it (`Status: Superseded by 000X` on the old file
  — never silently rewrite an accepted ADR out from under existing comment references to it).
- If the nested `CLAUDE.md`'s invariants list or ADR links are now stale because of this task's
  change, update them the same way root `CLAUDE.md` gets updated in Step 1.

If this task touched a sub-feature folder that **has no** nested `CLAUDE.md` yet:

- If the change you made there was itself non-trivial (new service, new non-obvious behavior, a
  real design decision — not a one-line fix or a trivial passthrough), create a minimal nested
  `CLAUDE.md` for that folder documenting what's now known, mirroring sibling structure (see
  `sfc-status/CLAUDE.md` or `gtc/CLAUDE.md` for the shape of a feature with no ADR; `claim-letter`/
  `devolution-formula` for one that has ADRs). Scope it to what this task actually touched and
  what's needed to understand it — a full retroactive audit of everything else already in that
  folder is Mode B's job, not this one.
- If the task's change was trivial, leave the folder without a `CLAUDE.md` — don't create one
  speculatively for an unrelated reason.
- Either way, if a decision you just introduced is genuinely load-bearing (concurrency, a subtle
  workaround, a tradeoff with consequences elsewhere), give it a `docs/adr/0001-*.md` under that
  folder rather than a long inline comment. If nothing rises to that bar, don't create one — say so
  in the new CLAUDE.md instead, the same way `gtc`'s and `sfc-status`'s do.

If nothing in the above changed this task, say so and move on.

### Step 3 — Verify README.md

Root: `README.md`. If missing, create it. If present, keep it in sync with reality, not with CLAUDE.md — README is for humans setting up the project (install, run, test, high-level description); CLAUDE.md is for Claude Code (commands + architecture reference). Don't duplicate CLAUDE.md's architecture deep-dive into README; a short "what this project is" plus setup/run/test steps is enough.

Update only if this task's `xvi-fc` change affected: install/setup steps, how to run the app, how to run tests, or the project's one-line description. Otherwise leave it alone — and leave any unrelated README staleness untouched, since it's outside this task's `xvi-fc` scope.

## Mode B — Full Folder Audit (manual)

Runs against one named sub-feature folder under `src/module/xvi-fc/` (e.g.
`src/module/xvi-fc/state/gtc/`), independent of whatever the current session was doing before. This
is the same process already run — and reviewed to a 9/9 comment-style bar — on `request-exemption`
and `gtc`.

1. Read the target folder's existing nested `CLAUDE.md` in full, if it has one. If it doesn't, read
   two or three sibling `state/*/CLAUDE.md` files as pattern reference before writing anything —
   `claim-letter/CLAUDE.md` (a feature with ADRs) and `devolution-formula/CLAUDE.md` or
   `gtc/CLAUDE.md` (form-level+installment, no ADR) are good defaults.
2. If no nested `CLAUDE.md` exists and the folder has real structure (services/helpers, multiple
   files, non-trivial business logic — not a thin passthrough): read every source file in the
   folder, understand what it actually does (not what a stale comment claims), and write a
   `CLAUDE.md` following the sibling structure — purpose, file layout with one line per file's
   role, non-obvious behavior/history/gotchas, known gaps. Only document something genuinely
   non-obvious; don't pad it to look thorough.
3. Identify any decision inside that's genuinely load-bearing and not yet captured anywhere
   (concurrency/locking, a subtle bug workaround, a design tradeoff with real consequences
   elsewhere) — write it up as a new `docs/adr/000N-*.md` under that folder, following the existing
   ADR shape (Status / Context / Decision / Consumers / Consequences — see `claim-letter`'s or
   `devolution-formula`'s ADRs). If nothing in the folder rises to that bar, say so explicitly in
   the CLAUDE.md (mirroring `gtc`'s/`sfc-status`'s "No ADRs exist for this module..." line) rather
   than manufacture one. If the same decision is shared with a sibling module, point to that
   module's existing ADR instead of duplicating it (the way `elected-urban-local-bodies` points at
   `devolution-formula`'s dataset-versioning ADR).
4. Go through every source file in the folder — controllers, module, services, dto, types, helpers,
   constants — and apply the Comment Style Contract to _every_ comment already there, not just ones
   touched by a recent change. Files with nothing wrong don't need to be touched.
5. Don't change behavior anywhere in this pass — comments and docs only.
6. Run the folder's own tests to confirm nothing broke: `npx jest <folder-path>`.
7. Before reporting, self-rate each file you touched on its resulting comment style, 0-9. If
   anything is still below 9, fix it or say plainly why it's staying that way — don't report done
   at a lower bar than what was already validated on `request-exemption`/`gtc`.

## Report, then summarize

State plainly what was checked and what (if anything) changed in each file — one or two lines per
file, not a diff dump — then proceed to the task's final summary as normal. For Mode B, include the
per-file self-ratings from step 7.
