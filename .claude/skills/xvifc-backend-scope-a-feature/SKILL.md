---
name: xvifc-backend-scope-a-feature
description: Use whenever the user says something like "I want to add a feature" or otherwise proposes new backend functionality that belongs in `src/module/xvi-fc` (e.g. state forms, ULB annual accounts, FC unspent declaration, side-menu, dashboard, devolution-formula, sfc-status, mohua, or any other xvi-fc subfeature), before any code is written. Runs a short scoping conversation — clarifying questions, edge cases, adjacent-feature ideas — and gets explicit approval on a restated plan before implementation begins. Do not use for bug fixes, small tweaks, features outside `src/module/xvi-fc` (e.g. auth, users, admin/afs-digitization, web/resources-section), or when the user has already given a fully-specified spec and asked you to just build it.
---

# Scope a Feature (xvi-fc only)

Do not write or edit code until Step 4 is complete.

0. **Confirm scope** — this skill applies only to new functionality inside `src/module/xvi-fc`. If the requested feature lives outside that folder (e.g. `src/module/auth`, `src/admin`, `src/users`, `src/web`), do not run this scoping gate — proceed normally instead.
1. **Ask sharp clarifying questions** — enough to remove real ambiguity, not a checklist for its own sake. Cover at minimum: who/what triggers this (API consumer, role/permission needed), the data shape in and out, how it should fail (validation errors, auth failures, not-found), and edge cases specific to this codebase (e.g. does it need Redis caching, a BullMQ queue, a new Mongo schema/index, multi-role access like `STATE`/`ULB`/`ADMIN`). Ask as one batch, not one at a time.
2. **Suggest adjacent ideas** — 2–4 concrete extensions or related features the user might also want, grounded in what already exists in this codebase (e.g. "since you're adding a new state-level form, want a matching admin review/approve endpoint too, following the `xvi-fc-review` pattern?"). Offer, don't push.
3. **Wait for answers.** Don't proceed on assumptions for anything asked in Step 1.
4. **Restate the plan in one paragraph** — what will be built, the endpoints/module/schema touched, and what was explicitly deferred or declined. Ask for approval.
5. **Only after explicit approval**, start implementation.

Keep the whole exchange tight — this is a scoping gate, not an interview marathon.
