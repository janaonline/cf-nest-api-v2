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
```

## Architecture

### Module Layout

```
src/
├── module/auth/         # JWT auth, OTP, login, refresh token rotation
├── users/               # User CRUD with repository pattern
├── admin/
│   └── afs-digitization/ # AFS file processing with BullMQ queues
├── web/
│   └── resources-section/ # Resource downloads + async ZIP generation
├── common/              # Global filter (HttpExceptionFilter), interceptor (ResponseTransformInterceptor)
├── core/                # Redis, S3, SES, email queue, nodemailer
├── schemas/             # All Mongoose schemas (14 total)
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

### Authorization

13 roles defined in `src/module/auth/enum/role.enum.ts`. Protect routes with:
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

Queue name constants are in `src/core/constants/queues.ts`. There are four queues:
- `EMAIL_QUEUE` — async email sending via Nodemailer
- `AFS_DIGITIZATION_QUEUE` — AFS file processing
- `AUDITORS_REPORT_OCR_QUEUE` — OCR for audit documents
- `ZIP_RESOURCES_QUEUE` — async ZIP generation

BullBoard admin UI is at `/admin/queues` (HTTP basic auth via `ADMIN_USER`/`ADMIN_PASSWORD`).

### Key Global Providers

Registered in `AppModule` and available everywhere:
- `CacheModule` (global, 5-min TTL in-memory)
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
