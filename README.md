# CityFinance API (v2)

NestJS backend for CityFinance — auth, ULB/state master data, the 16th Finance Commission
("xvi-fc") state/ULB/MoHUA forms, and supporting admin/digitization tooling. See
[CLAUDE.md](CLAUDE.md) for the full architecture reference (module layout, auth flow, response
shape, BullMQ queues) and per-feature `CLAUDE.md` files under `src/module/xvi-fc/**` for individual
sub-feature invariants.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env` and fill in the required variables (MongoDB URIs, Redis, JWT secrets, AWS buckets,
   reCAPTCHA, etc.) — see the Environment Variables table in [CLAUDE.md](CLAUDE.md).

## Running

```bash
npm run start:dev   # watch-mode dev server
npm run build        # compile TypeScript
```

BullBoard (queue admin UI) is available at `/admin/queues` once running (HTTP basic auth via
`ADMIN_USER`/`ADMIN_PASSWORD`).

## Testing

```bash
npm test              # unit tests (*.spec.ts)
npm run test:watch    # unit tests, watch mode
npm run test:cov       # unit tests with coverage
npm run test:e2e       # e2e tests (test/*.e2e-spec.ts)

# Run a single test file
npx jest src/module/auth/auth.service.spec.ts
```

## Code quality

```bash
npm run lint     # ESLint with auto-fix
npm run format   # Prettier format
```
