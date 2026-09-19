# Mobile API v1 conventions

Read this before adding an endpoint under `/api/mobile/v1`. Full design context lives in
`docs/superpowers/plans/2026-09-18-mobile-phase0b-api-foundation.md` and the mobile repo's
`docs/superpowers/specs/2026-09-18-flutter-mobile-app-master-design.md` §7.

## Base path

`/api/mobile/v1`, Route Handlers under `app/api/mobile/v1/…`. The `middleware.ts` matcher
excludes `api` entirely — these routes bypass next-intl and the page auth guard, so every
handler authenticates itself via `defineEndpoint`'s `auth` level.

## Envelope

- Success: `{ "data": … }`
- Error: `{ "error": { "code": string, "message": string, "fields"?: Record<string,string> } }`
- Every response carries `X-Api-Version: 1`.

## Error codes

`code` reuses the web's existing `errorCode` strings wherever one exists, so translations and
client-side handling are shared between web and mobile. Don't invent a new code for something
the web already has a string for.

## Auth levels

`defineEndpoint`'s `auth` field is one of:
- `'public'` — anonymous allowed; handler receives `ctx: MobileCtx | null`.
- `'user'` — any signed-in caller.
- `'staff'` — `ctx.isStaff` (admin or moderator).
- `'admin'` — `ctx.isAdmin` only.

Auth is always the bearer token via `supabase.auth.getUser(token)` — network-verified, never a
locally-decoded JWT and never `getSession()` (see the middleware timeout incident in
`ROADMAP.md`). The service-role client (`ctx.admin`) is used only where the equivalent web code
already uses it; the caller id always comes from the verified token, never the request body.

## How to add an endpoint

1. Define it in `lib/mobile-api/endpoints/<domain>.ts` with `defineEndpoint({...})`.
2. Append it to `ALL_ENDPOINTS` in `lib/mobile-api/endpoints/index.ts`.
3. Add a one-line route file under `app/api/mobile/v1/<path>/route.ts` that re-exports the
   handler as the HTTP method.
4. Run `npm run openapi` and commit the updated `openapi/mobile-v1.json` — it is a vitest file
   snapshot, so `npm run test` fails whenever it goes stale.
5. Per spec §7.1: the endpoint handler and any Server Action doing the same thing must call the
   same service function — never fork the logic into two implementations.

## Deferred (YAGNI — added by the first phase that needs them)

- Idempotency keys (`api_idempotency_keys`)
- Rate limiting
- `/session/start`
- `/auth/signup`
- Upload signing

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MOBILE_MIN_APP_VERSION` | `0.0.0` | Below this, non-`skipVersionGate` requests get 426 `app_update_required`. |
| `MOBILE_LATEST_APP_VERSION` | `1.0.0` | Reported via `/config` for update prompts. |
| `MOBILE_MAINTENANCE_MESSAGE` | unset (off) | When set, `/config.maintenance.message` is populated. |
| `MOBILE_FEATURES_OFF` | unset | Comma-separated feature keys to disable in `/config.features`. |
| `ANDROID_PACKAGE_NAME` | `ng.com.sentinelxesports.app` | Used in `assetlinks.json`. |
| `ANDROID_CERT_SHA256` | unset | Comma-separated SHA-256 signing fingerprints; `assetlinks.json` returns `[]` until set. |
