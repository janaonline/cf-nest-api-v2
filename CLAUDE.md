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
npm run seed:mohua-side-menu       # Seed MoHUA side-menu entries (scripts/seed-mohua-side-menu.ts)
npm run migrate:xvifc-side-menu    # Migrate xvi-fc side-menu data (scripts/migrate-xvifc-sidemenu.ts)
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
│   ├── side-menu/, cache/, common/ # XviFcCacheService/Interceptor, form-actors, form-status-access helpers shared across sub-features
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

### Database

Two MongoDB connections:
- `MONGO_URI` — main app database (default connection)
- `MONGO_URI_2` — digitization database (`connectionName: 'digitization_db'`)

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
| `MONGO_URI` | Main MongoDB connection |
| `MONGO_URI_2` | Digitization MongoDB connection |
| `REDIS_URL` | Redis for BullMQ and OTP storage |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Token signing |
| `AWS_BUCKET_NAME` / `AWS_DIGITIZATION_BUCKET_NAME` | S3 buckets |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA v3 (set `RECAPTCHA_SKIP_DEV=true` locally) |
| `OTP_TTL_SECONDS` | OTP expiry in Redis |
| `CLIENT_URL` / `WHITELISTED_DOMAINS` | CORS origins |
| `BANK_ACCOUNT_ENCRYPTION_KEY` / `BANK_ACCOUNT_HASH_SECRET` | `xvi-fc` ULB bank-account encryption/hashing (`module/xvi-fc/ulb/bank-account`) |
| `MANUAL_REVIEW_NOTIFY_EMAIL` | Fixed inbox emailed when a ULB requests manual review of a failed OCR validation (`module/xvi-fc/ulb/annual_accounts`) |
