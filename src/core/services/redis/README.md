# NamespacedCacheService

Shared no-TTL, domain-key cache helper used by `FormJsonService` and `SideMenuService`. A key is
built from domain values (role, year, form id, ...) — never from the request URL — so it can't
drift out of sync with the app's route prefix the way the side-menu cache once did (see git
history: the old URL-keyed cache's admin-invalidation path silently no-opped because it built the
key without the `/api/v2` global prefix the interceptor actually stored under).

Registered globally in `RedisModule` (`@Global()`), so any service can inject
`NamespacedCacheService` directly with no extra module imports.

## Key format

```
<namespace>:<env>:<part1>:<part2>:...
```

`env` comes from `NODE_ENV` (`development`, `production`, ...).

| Consumer | Namespace | Key example |
|---|---|---|
| `SideMenuService` | `sidemenu` | `sidemenu:development:ULB:67d7d136d3d038946a5239e9` |
| `FormJsonService` | `formJson` | `formJson:development:67d7d136d3d038946a5239e9:32` |
| `FormJsonService` (claim-eligibility list) | `formJson` | `formJson:development:67d7d136d3d038946a5239e9:claimEligibilitySources` |

No TTL — entries live until explicitly invalidated. Every mutating method on both services
(`create`/`update`/`toggleActive`/`remove`/bulk variants) deletes the exact key(s) it just
affected, using the same `buildKey`/`buildPattern` helpers the read path uses — read, write, and
invalidate can't drift apart since they're built the same way in the same file.

## Deleting a cache entry manually

Only needed for debugging or clearing something outside the normal write path — the admin CRUD
already invalidates the right key automatically on every write.

### Via `redis-cli`

```bash
# Side menu — one role+year
redis-cli DEL "sidemenu:development:ULB:67d7d136d3d038946a5239e9"

# FormJson — one design year + form
redis-cli DEL "formJson:development:67d7d136d3d038946a5239e9:32"

# FormJson — claim-eligibility sources list for a design year
redis-cli DEL "formJson:development:67d7d136d3d038946a5239e9:claimEligibilitySources"
```

To clear a whole namespace/year without knowing every key, use `--scan` (never `KEYS *` — it
blocks the whole Redis instance):

```bash
redis-cli --scan --pattern "sidemenu:development:*" | xargs -r redis-cli DEL
redis-cli --scan --pattern "formJson:development:*" | xargs -r redis-cli DEL
```

### Via the admin API (Swagger)

Swagger UI: `/api/v2/api-docs`. Both endpoints are `@ApiBearerAuth()` + admin-scope guarded —
click **Authorize** (top right) and paste an admin JWT access token first.

Under the **XVI-FC** tag:

- `DELETE /xvi-fc/admin/cache/side-menu` — optional query params `role`, `yearId`. Omit either to
  widen the match (e.g. `role` alone clears that role across every year).
- `DELETE /xvi-fc/admin/cache/form-json` — optional query params `designYearId`, `formId`. Same
  omit-to-widen behavior.

Click **Try it out**, fill in the fields you want to scope by, **Execute**. The response reports
how many entries were actually deleted (`{ "message": "Cleared N cache entries..." }` or
`"...nothing was cleared"`), so you can tell a real hit from a no-op.

Equivalent `curl`:

```bash
curl -X DELETE "https://<host>/api/v2/xvi-fc/admin/cache/side-menu?role=ULB&yearId=67d7d136d3d038946a5239e9" \
  -H "Authorization: Bearer <admin-token>"

curl -X DELETE "https://<host>/api/v2/xvi-fc/admin/cache/form-json?designYearId=67d7d136d3d038946a5239e9&formId=32" \
  -H "Authorization: Bearer <admin-token>"
```
