# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev        # Watch mode dev server
npm run build            # Compile TypeScript

# Testing
npm test                 # Unit tests (*.spec.ts)
npm run test:watch       # Unit tests in watch mode
npm run test:cov         # Unit tests with coverage
npm run test:e2e         # E2E tests (test/*.e2e-spec.ts)

# Run a single test file
npx jest src/module/auth/auth.service.spec.ts

# Code quality
npm run lint             # ESLint with auto-fix
npm run format           # Prettier format

# xvi-fc one-off scripts
npm run migrate:xvifc-in-progress-since  # Backfill inProgressSince on pre-existing IN_PROGRESS annual
                                          # accounts (scripts/backfill-annual-account-in-progress-since.ts) —
                                          # safe/re-runnable, only touches records still missing the field
```

## Architecture

### Module Layout

```
src/
├── module/auth/         # JWT auth, OTP, login, refresh token rotation
├── module/ulb-eligibility/ # Shared, grant-cycle-parameterized ULB eligibility service (e.g. Cantonment
│                        # Board exclusion from 'XVIFC') — consumed by both module/auth (login-time gate)
│                        # and module/xvi-fc (write-path guards, list/template/count filters). Its
│                        # ineligible-UlbType-id cache is Redis-backed (RedisService) and purely
│                        # event-driven — no TTL — cleared only by admin/ulb-types's CRUD (below).
│                        # `ulb-eligibility.constants.ts` holds the user-facing ineligibility message
│                        # every call site throws — do not retype the literal string; the frontend
│                        # (login.component.ts) matches on it verbatim to redirect instead of showing
│                        # an inline error, so changing it means updating both sides together
├── module/xvi-fc/       # 16th Finance Commission forms (state/ULB/MoHUA roles)
│   ├── ulb/             # annual_accounts (OCR via ANNUAL_ACCOUNT_PROCESSING_QUEUE), bank-account, unspent-balance-disclosure
│   ├── state/           # sfc-status, elected-urban-local-bodies, devolution-formula, fc-unspent-declaration, dashboard
│   ├── mohua/           # fc-unspent-declaration review workflow
│   ├── side-menu/, cache/, common/ # XviFcCacheService/Interceptor, form-actors, form-status-access helpers,
│   │                     # YearAccessService (dynamic year access/exemption for new ULBs - see below) shared
│   │                     # across sub-features
│   │   └── common/reminders/    # Dwell-time reminder crons (daily 9AM IST): ULB Nodal Officer nudge for
│   │                            # Annual Accounts stuck IN_PROGRESS (every 3 days), STATE digest (HTML
│   │                            # table + PDF attachment) for Annual Account/Bank Account forms stuck
│   │                            # UNDER_REVIEW_BY_STATE (every 7 days). Cadence tracked via a
│   │                            # `lastReminderSentAt` timestamp on each form doc, never a stored day
│   │                            # count. Also `WeeklyStateSummaryService` (Monday 11AM IST) — per-state
│   │                            # Annual Account status counts (Not Started/Under Review/Approved/
│   │                            # UNDER_REVIEW_BY_MOHUA + a 10-day-stale review count), one email per
│   │                            # state to users with role STATE and an assigned xviFcSubrole
│   │                            # (admin/reviewer/viewer) AND isXVIFCProfileVerified: true. These 3 crons
│   │                            # are gated by the single `XVIFC_REMINDER_CRONS_ENABLED` env flag — each
│   │                            # `@Cron`-decorated method checks it and no-ops if not exactly 'true'; the
│   │                            # manual trigger endpoints call the underlying method directly and bypass
│   │                            # the flag. Email copy for all three lives in DB-backed `EmailTemplate`
│   │                            # rows (slugs `ulb-in-progress-reminder`/`state-review-reminder`/
│   │                            # `weekly-state-summary`) — `RemindersModule.onModuleInit` auto-seeds all
│   │                            # four templates on every app boot (idempotent, no manual step needed);
│   │                            # the `POST xvi-fc/reminders/seed-*-template` endpoints still exist for an
│   │                            # on-demand re-seed without restarting the app. Also
│   │                            # `FormReturnedNotificationService` (slug `form-returned-notification`) —
│   │                            # event-triggered, not a cron: fires once, synchronously, the moment
│   │                            # STATE returns an Annual Account section or Bank Account form (called
│   │                            # from `decideSection`/`decideBankAccount`), so it is NOT gated by
│   │                            # `XVIFC_REMINDER_CRONS_ENABLED` and has no `send-*-now` endpoint. Never
│   │                            # throws — a notification failure must not fail the underlying decision.
│   └── xvi-fc.module.ts # composition root importing the feature modules above
├── users/               # User CRUD with repository pattern
├── admin/
│   ├── afs-digitization/ # AFS file processing with BullMQ queues
│   └── ulb-types/       # ADMIN-only CRUD for the `ulbtypes` reference-data collection (in particular
│                        # `ineligibleForGrantCycles`); calls UlbEligibilityService.invalidate() on
│                        # every create/update/remove that touches that field
├── web/
│   └── resources-section/ # Resource downloads + async ZIP generation
├── common/              # Global filter (HttpExceptionFilter), interceptor (ResponseTransformInterceptor)
├── core/                # Redis, S3, SES, email queue, nodemailer
├── schemas/             # All Mongoose schemas (38 total, incl. schemas/xvi-fc/ for the xvi-fc module)
├── middleware/          # LoggerMiddleware, RecaptchaMiddleware
└── views/mail/          # Handlebars email templates
```

### xvi-fc Dynamic Year Access

Replaces the old module's hardcoded `Ulb.access_20xx` boolean fields (deprecated, confirmed unused in this app, left in place only because the separate old Express app still reads them) with two admin-set facts on `Ulb` (`startYear`, `yearAccess`) plus a per-formId `formJsonConfig` collection, so a genuinely new ULB can be exempted from specific forms without a schema/code change per year.

Full docs live with the code, not here: [`module/xvi-fc/common/services/CLAUDE.md`](src/module/xvi-fc/common/services/CLAUDE.md) (the mechanism — `YearAccessService`, the data model, lazy materialization) and [`master/form-json-config/CLAUDE.md`](src/master/form-json-config/CLAUDE.md) (the config side, the formId registry, and how to extend this to a new form).

### Database

One physical connection (`MONGO_URI`), two logical databases selected by name:
- `MONGO_DB_NAME` — main app database, set as `dbName` on the default `MongooseModule.forRootAsync` connection
- `DIGITIZATION_DB_NAME` — digitization database, exposed as connection `'digitization_db'`. `src/core/database/digitization-db.module.ts` (global) derives it from the default connection via `connection.useDb(DIGITIZATION_DB_NAME, { useCache: true })` instead of opening a second socket/connection pool — both databases must live on the same server/cluster reachable via `MONGO_URI`.

When defining models that belong to the digitization DB, use `MongooseModule.forFeature([...], 'digitization_db')` and inject with `@InjectModel(Model.name, 'digitization_db')`.

### Authentication Flow

1. Login → `LoginService` validates credentials → `AuthService` issues JWT access token (15m) + refresh token (7d)
2. Refresh token is hashed and stored on the user document; sent to client as HTTP-only cookie
3. `JwtStrategy` extracts the access token from `Authorization: Bearer` or `x-access-token` header
4. `JwtRefreshStrategy` extracts the refresh token from the `refresh_token` cookie and compares against the stored hash
5. `JwtAuthGuard` is registered globally (APP_GUARD); routes decorated with `@Public()` bypass it
6. OTP login: `OtpService` generates + sends OTP, stored in Redis with `OTP_TTL_SECONDS` TTL
7. XVI-FC grant-cycle eligibility gate: for `Role.ULB` users logging in with `dto.type` of `16thFC`/`XVIFC`, `LoginService.login()` checks `UlbEligibilityService.isUlbEligibleForGrantCycle(ulb, 'XVIFC')` — checked only *after* credentials are confirmed valid (never before, to avoid leaking a ULB's eligibility to an unauthenticated caller) — and rejects with `ForbiddenException` before issuing tokens if the ULB's type is excluded (e.g. Cantonment Board). `GET /auth/me` also exposes a live `isEligibleForXviFc` flag for already-authenticated sessions. `OtpService.verifyOtp()` deliberately does **not** carry this gate — it's a shared endpoint used by every grant cycle (15th FC, Ranking, etc.), and neither `VerifyOtpDto` nor the Redis OTP record carry a `type`/grant-cycle field to scope a check on the way `dto.type` lets `login()` do; a Cantonment-Board ULB that authenticates via this path is still blocked at the XVI-FC write-path guards (`assertUlbEligibleForGrantCycle`) and the frontend's `/xvifc/**` route guard (which re-derives eligibility live via `/auth/me`, independent of how the token was issued).

### Authorization

16 roles defined in `src/module/auth/enum/role.enum.ts`, including `xvi-fc`-specific ones (`PMU`, `AAINA`, `ULB-EDITOR`/`ULB-VIEWER`, `STATE-EDITOR`/`STATE-VIEWER`). Protect routes with:
```ts
@Roles(Role.ADMIN, Role.STATE)   // applied at controller or handler level
@UseGuards(RolesGuard)
```

`RolesGuard` reads `@Roles()` metadata; if no metadata is set the route is accessible to any authenticated user.

### Response Shape

`ResponseTransformInterceptor` wraps every response:
```json
{ "success": true, "data": ..., "timestamp": "..." }
```

Auth endpoints (`/login`, `/refresh`, `/verifyOtp`) are special-cased to flatten to:
```json
{ "success": true, "token": ..., "user": ..., "timestamp": "..." }
```

`HttpExceptionFilter` normalizes errors to:
```json
{ "statusCode": ..., "message": ..., "timestamp": "...", "path": "..." }
```

Custom status codes in use: `440` (session expired), `422` (invalid OTP), `409` (duplicate resource).

### BullMQ Queues

Queue name constants are in `src/core/constants/queues.ts`. There are five queues:
- `EMAIL_QUEUE` — async email sending via Nodemailer
- `AFS_DIGITIZATION_QUEUE` — AFS file processing
- `AUDITORS_REPORT_OCR_QUEUE` — OCR for audit documents
- `ZIP_RESOURCES_QUEUE` — async ZIP generation
- `ANNUAL_ACCOUNT_PROCESSING_QUEUE` — OCR validation for `xvi-fc` ULB annual account uploads (processed in `module/xvi-fc/ulb/annual_accounts/annual-account-ocr.processor.ts`)

BullBoard admin UI is at `/admin/queues` (HTTP basic auth via `ADMIN_USER`/`ADMIN_PASSWORD`).

### Key Global Providers

Registered in `AppModule` and available everywhere:
- `CacheModule` (global, 5-min TTL, **in-memory** — local to a single Node process, not shared across
  replicas; prefer `RedisService` over this for anything that must invalidate consistently across
  instances, e.g. `UlbEligibilityService`'s reference-data cache)
- `ThrottlerModule` (60 req / 60s window; override per-route with `@Throttle()`)
- `RedisModule` (global, inject `RedisService` to access the ioredis client)
- `APP_GUARD`: `JwtAuthGuard` then `ThrottlerGuard` (order matters)
- `APP_INTERCEPTOR`: `ResponseTransformInterceptor`
- `APP_FILTER`: `HttpExceptionFilter`

### Testing Patterns

Unit tests mock Mongoose models via `getModelToken(ModelName.name)`:
```ts
providers: [
  MyService,
  { provide: getModelToken(User.name), useValue: mockUserModel },
]
```

E2E tests use `supertest` against a full NestJS app bootstrapped in `beforeAll`.

## Environment Variables

Required variables (see `.env` for dev defaults):

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB server/cluster connection (single physical connection, no db name) |
| `MONGO_DB_NAME` | Main app database name (default connection) |
| `DIGITIZATION_DB_NAME` | Digitization database name (reuses the default connection via `useDb`, connection name `'digitization_db'`) |
| `REDIS_URL` | Redis for BullMQ and OTP storage |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Token signing |
| `AWS_BUCKET_NAME` / `AWS_DIGITIZATION_BUCKET_NAME` | S3 buckets |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA v3 (set `RECAPTCHA_SKIP_DEV=true` locally) |
| `OTP_TTL_SECONDS` | OTP expiry in Redis |
| `OTP_FORCE_REAL_DELIVERY` | Set `true` in dev/staging to send real OTPs (random code + actual SMS/email) without flipping `NODE_ENV` |
| `CLIENT_URL` / `WHITELISTED_DOMAINS` | CORS origins |
| `BANK_ACCOUNT_ENCRYPTION_KEY` / `BANK_ACCOUNT_HASH_SECRET` | `xvi-fc` ULB bank-account encryption/hashing (`module/xvi-fc/ulb/bank-account`) |
| `MANUAL_REVIEW_NOTIFY_EMAIL` | Fixed inbox emailed when a ULB requests manual review of a failed OCR validation (`module/xvi-fc/ulb/annual_accounts`) |
| `XVIFC_REMINDER_CRONS_ENABLED` | Master on/off switch for the 3 dwell-time/summary crons in `module/xvi-fc/common/reminders` — must be exactly `'true'` for their scheduled runs to fire; manual triggers bypass this flag regardless of its value. Does not gate `FormReturnedNotificationService`, which is event-triggered, not a cron |
