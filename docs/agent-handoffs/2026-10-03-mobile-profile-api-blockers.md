# Mobile profile-onboarding API blockers

The Flutter implementation is waiting on the final web contract for player profile completion. Please resolve the items below before handing the feature to `sentinelx_mobile`.

## Required contract changes

1. `GET /api/mobile/v1/me` must return `profileCompletedAt` in addition to the planned `consentWhatsappUpdates` and `gameInterests` fields. Flutter needs this server-owned value to resolve its onboarding gate.
2. Add an authenticated mobile onboarding write under `/api/mobile/v1`, preferably `POST /api/mobile/v1/onboarding/profile`, that accepts the complete required payload:
   - `country`
   - `whatsapp`
   - explicit `consentWhatsappUpdates: boolean`
   - at least one `gameInterest` UUID
3. The endpoint must normalize WhatsApp to E.164 using the selected country's numbering plan and return field-level validation errors through the standard mobile API error envelope.
4. Successful completion must update the profile fields, replace game interests, and stamp `profile_completed_at`. A settings-only `PATCH /me/profile` that does not stamp completion is not sufficient for Flutter onboarding.
5. Keep the planned `PATCH /me/profile` additions optional so previously shipped mobile clients remain compatible.

## Data-integrity blocker

The current worktree has uncommitted `performUpdateProfile()` changes that await `replaceGameInterests()` but ignore its `{ ok: false }` result. The onboarding service also writes `profile_completed_at` before replacing game interests.

Do not report success or leave `profile_completed_at` set when the required game-interest write fails. Please make completion atomic if practical (for example, one database RPC/transaction). At minimum, order and compensate the writes so a failed game-interest replacement cannot leave a completed profile with zero required interests, and test that failure path.

## Integration and verification

1. Rebase/merge the profile branch onto current `origin/main`; it currently predates the latest Masters/Champions invitation changes.
2. Finish and commit every web plan task relevant to the mobile contract.
3. Run `npm run openapi` last and commit `openapi/mobile-v1.json`.
4. Verify the endpoint tests cover:
   - incomplete and completed `/me` responses;
   - consent `true` and `false` without coercion;
   - empty game-interest rejection;
   - invalid country/WhatsApp pairing;
   - game-interest write failure without marking completion;
   - an old `PATCH /me/profile` body that omits the new optional fields.
5. Run the required web checks (`npx vitest run`, `npm run lint`, and `npm run build`). Do not test writes against production.

## Handoff back to mobile

Please add a dated note under `docs/agent-handoffs/` containing:

- final branch and commit;
- exact operation IDs and paths;
- final request/response examples;
- error codes and field names;
- whether the migration has been applied to staging;
- verification results;
- confirmation that `openapi/mobile-v1.json` is regenerated and committed.

Once that handoff exists, mobile can copy the OpenAPI file, write its implementation plan, and start the Flutter work without guessing the contract.
