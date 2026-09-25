# 0002 - Eligibility gating and the SFC finalSubmit race window

## Status

Accepted

## Context

An exemption is meaningless — or actively wrong — once its target form already has real progress, or
already satisfies the requirement the exemption would excuse it from. But both state and time move: a
check made once at filing time can go stale by the time MoHUA actually decides, and a target form's own
write path can race with a decision being made about an exemption that concerns it.

## Decision

**Fail fast at filing, re-verify at decision.** `RequestExemptionService.assertTargetFormsEligible`
(per-ULB) and `assertTargetStateFormsEligible` (whole-state) run at `finalSubmit` time so a doomed request
never sits in MoHUA's queue in the first place. `RequestExemptionMohuaService.assertSectionStillEligible`
re-runs the equivalent check at decide time, since real time can pass between filing and decision.

**Each target form's check is shaped differently, because "real progress" means something different per
form:**
- **AFS, formId 30/31** (`AFS_SECTION_TYPE_BY_FORM_ID`): a real per-ULB `XviFcAnnualAccount` document
  exists and its `form_status_id` is no longer in `ULB_EDITABLE_STATUS_IDS`. No document at all is
  treated as NOT_STARTED-equivalent — eligible.
- **SFC Status, formId 22, whole-state only** (`STATE_FORM_IDS_WITH_REAL_PROGRESS_CHECK`): a real
  `XviFcSfcStatus` document exists and its `currentFormStatus` is no longer in `STATE_EDITABLE_STATUS_IDS`.
  Same no-document-is-eligible convention.
- **Elected Body, formId 23** (`assertElectedBodyRowNotAlreadyEligible`): there is no per-ULB
  submission-status document to check the way 30/31 have — Elected Body's row-level domain value
  (`electedBodyStatus`) and its submission-workflow status (`rowStatus`) move independently. So this
  check asks a different question: not "has this been submitted for review" but "does the ULB's current
  row value already satisfy the eligibility requirement" — an exemption only makes sense when it doesn't
  (e.g. "Not Constituted"); requesting one for a ULB that's already "Constituted"/"6th Schedule" has
  nothing to excuse. The set of values that count as "already eligible" is read live from Elected Body's
  own `claimEligibility.evaluator.config.rowEligibleValues` (via `FormJsonService`), not a second
  hardcoded list, so an admin's edit to that config changes this gate with no code deploy.

**409, never 403, for an exemption-block response.** Every place this module (and its outbound
dependents, below) blocks on an exemption uses `ConflictException`, never `ForbiddenException`. The
frontend's global HTTP interceptor force-logs-out the user on *any* 403 — correct for a genuine access
violation, wrong for a normal, expected business conflict that a fully authorized user can hit with no
client-side guard preventing it (unlike most `ForbiddenException`s in this codebase's state forms, where
the UI already disables the button first).

**Stale permissions are corrected post-hoc.** Two consuming forms' own permission builders are
status-only and have no exemption awareness, so each overrides its response after the fact when the
relevant exemption is `PENDING` or `APPROVED`: `SfcStatusService.getForm` sets `canEdit`/`canFinalSubmit`
to `false`; `AnnualAccountsService.getProcessingStatus` sets `canUpload` to `false`.

**The SFC `finalSubmit` race window.** A TOCTOU gap existed between `SfcStatusService.finalSubmit`
loading/validating a submission and actually writing it — MoHUA could approve an exemption for that ULB's
SFC form inside that window, after the block-check had already passed. Mitigated by adding a second
`assertNotBlockedByExemption` call immediately before the write (after validation/file-normalization),
narrowing the window rather than introducing full mutual exclusion. MoHUA's own `approve()` path was
assessed separately and found to already have a near-minimal window (a single non-I/O
`connection.startSession()` await) — left unchanged.

## Consumers

- **Inside this module**: `RequestExemptionService.assertTargetFormsEligible` /
  `assertTargetStateFormsEligible` / `assertElectedBodyRowNotAlreadyEligible` (filing-time checks).
- **Outside this module**:
  - `RequestExemptionMohuaService` (`mohua/request-exemption/`) — `assertSectionStillEligible`,
    decide-time re-verification of the same checks.
  - `SfcStatusService` (`state/sfc-status/`) — `assertNotBlockedByExemption` (called twice in
    `finalSubmit`, see the race-window fix above), `getForm`'s permission override.
  - `AnnualAccountsService` (`ulb/annual_accounts/`) — `assertNotBlockedByPendingExemption`,
    `getProcessingStatus`'s permission override.

## Consequences

- A new "real progress" target form needs both a filing-time check here and a matching decide-time check
  in `RequestExemptionMohuaService`, and its own service should consider whether its write path needs the
  same kind of pre-write re-check `SfcStatusService.finalSubmit` now has.
- Any new exemption-block response, anywhere, must use `ConflictException` — using `ForbiddenException`
  reintroduces the force-logout bug for a normal business conflict.
- Changing Elected Body's `rowEligibleValues` config changes this module's Elected Body eligibility gate
  immediately, with no deploy — a future editor of that config should know this module depends on it.
