# Game Designer & Per-Game Registration Fields — Design Spec

**Date:** 2026-09-27
**Status:** Approved for planning
**Builds on:** `2026-09-12-game-modes-formats-maps-design.md` (Mode → Format → Map → Match Rules, shipped), `2026-08-27-fc-mobile-competition-structure-design.md` (`tournament_type` as a game-agnostic tier concept)

---

## 1. Problem

Two admin-facing surfaces are still one-size-fits-all, in a codebase that otherwise treats "what a game needs" as data:

1. **Registration identity fields.** Every tournament, for every game, asks for the same two fields — `clubName` (required) and `ignTag` (optional) — hardcoded in four places (`lib/tournaments/registration-schema.ts`, `RegistrationPanel.tsx`'s register form, its waitlist form, and `lib/mobile-api/endpoints/tournaments.ts`'s register + waitlist handlers). A Free Fire player is asked for a "club name" that doesn't exist in that game; a future Roblox tournament has no way to ask for a Roblox username instead.

2. **Building a new game's competitive shape is a migration, not a UI action.** `game_modes` / `game_mode_formats` / `game_mode_maps` / `game_mode_match_rules` (the catalogue behind Free Fire's and PUBG Mobile's Mode → Format → Map → Match Rules pickers) are real tables with `is_staff()`-gated RLS, but nothing writes to them except hand-authored SQL migrations (`20260912090000_game_modes.sql`, `20260913062023_match_rules_catalogue_and_pubg_mobile.sql`). Opening a new game today means a developer, not Samuel, sits down and writes INSERT statements.

Both are instances of the same gap: the platform is built to run many games of different shapes (football, shooter/battle-royale, fighting, racing, and non-mobile-esports titles like Roblox and 8-Ball Pool — see `/games`), but two of its "what does this game need" surfaces still require code changes to extend.

## 2. Goals

- A staff member can fully configure a new game — its registration identity fields, its modes, each mode's formats/maps/match rules — **through an admin UI**, with no code change and no deploy.
- Raw SQL migrations remain a valid, supported way to seed the same tables — the UI is an additional writer, not a replacement. Both paths produce identical rows.
- No hardcoded "club name" / "IGN" anywhere in application code — every registration form (web + mobile, register + waitlist) renders whatever fields the tournament's game declares.
- No phased rollout of capability: format validation, admin CRUD, and dynamic storage all ship together, not "v1 now, validation later."

## 3. Non-goals

- No changes to *how* Mode/Format/Map/Match Rules are consumed on the public tournament-creation form (`TournamentForm.tsx`'s existing cascading selects, from the 2026-09-12 design) — this spec only adds the missing *writer* UI for that catalogue's data.
- No change to `match_types` (Bo1/Bo3/Bo5) beyond giving it a small admin section — it's global, not per-game, and rarely changes.
- No automatic inference of "what fields does category X need" — the user explicitly chose per-game configuration (not per-category) so two games sharing a category (Roblox and 8-Ball Pool are both `other`) can differ freely.

## 4. Registration fields catalogue

### 4.1 Schema

```sql
CREATE TABLE public.game_registration_fields (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id             uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  field_key           text NOT NULL,               -- 'club_name', 'roblox_username', 'platform_id'
  label               text NOT NULL,                -- 'Club name', 'Roblox Username'
  placeholder         text,
  input_type          text NOT NULL DEFAULT 'text',
  required            boolean NOT NULL DEFAULT true,
  validation_pattern  text,                         -- optional regex, enforced client + server
  validation_message  text,                         -- shown when the pattern fails
  show_on_bracket     boolean NOT NULL DEFAULT false, -- surface this field's value next to a player's name on the public bracket (replaces the current hardcoded club-name display — see §6.3)
  seq                 int NOT NULL DEFAULT 1,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grf_input_type_valid CHECK (input_type IN ('text', 'number', 'url')),
  CONSTRAINT grf_key_uniq UNIQUE (game_id, field_key)
);

CREATE INDEX game_registration_fields_game_idx ON public.game_registration_fields (game_id, seq);

ALTER TABLE public.game_registration_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "grf_public_read"  ON public.game_registration_fields FOR SELECT USING (true);
CREATE POLICY "grf_staff_write" ON public.game_registration_fields FOR ALL USING (is_staff()) WITH CHECK (is_staff());
```

Same trust model as `game_modes`: public read (the registration form needs it pre-login), staff write via RLS — no `createAdminClient()` needed for the actions that manage it (see §7.2).

### 4.2 Storage — `tournament_registrations.registration_details`

Replace the two fixed columns with one dynamic one:

```sql
ALTER TABLE public.tournament_registrations ADD COLUMN registration_details jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.tournament_registrations SET registration_details =
  jsonb_strip_nulls(jsonb_build_object('club_name', reg_club_name, 'ign_tag', reg_ign_tag));

ALTER TABLE public.tournament_registrations DROP COLUMN reg_club_name;
ALTER TABLE public.tournament_registrations DROP COLUMN reg_ign_tag;
```

One clean cutover — no deprecated columns left behind. `registration_details` is keyed by each game's `field_key`s, so a Free Fire registration stores `{"in_game_uid": "..."}` and a DLS one stores `{"club_name": "...", "ign_tag": "..."}`.

**Every current reader of `reg_club_name`/`reg_ign_tag` is a touch point and must be updated in the same change:**

| File | Current use |
|---|---|
| `lib/tournaments/register-service.ts` | Builds `regFields` written on all 5 registration paths (waiver, free, coin-covered, pending-payment insert/update) |
| `lib/tournaments/waitlist-service.ts` | Same, on waitlist insert |
| `lib/tournaments/bracket-view.ts` | Reads `reg_club_name` to show next to a player's name on the **public** bracket — becomes: look up whichever fields have `show_on_bracket = true` for that game and render their labeled values |
| `app/[locale]/admin/tournaments/[id]/registrations/page.tsx` | Admin registrations table — renders `regClubName`/`regIgnTag` columns; becomes a dynamic column set built from the game's active fields |
| `app/[locale]/admin/results/page.tsx` | Looks up `reg_club_name` by `tournament_id:player_id` for the results review queue |
| `components/admin/RegistrationsTable.tsx` | Consumes `regClubName` as a prop — becomes a generic label→value list |
| `lib/mobile-api/endpoints/tournaments.ts` | Register/waitlist request bodies and (indirectly) any response shape that echoes registration details |

### 4.3 Validation — built from the catalogue

```ts
// lib/tournaments/registration-fields.ts
export interface RegistrationField {
  fieldKey: string
  label: string
  placeholder: string | null
  inputType: 'text' | 'number' | 'url'
  required: boolean
  validationPattern: string | null
  validationMessage: string | null
  showOnBracket: boolean
}

export function buildRegistrationSchema(fields: RegistrationField[]): z.ZodObject<...> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) {
    let s: z.ZodTypeAny = z.string().trim().max(120)
    if (f.validationPattern) {
      s = (s as z.ZodString).regex(new RegExp(f.validationPattern), f.validationMessage ?? 'Invalid format')
    }
    shape[f.fieldKey] = f.required
      ? (s as z.ZodString).min(1, `${f.label} is required`)
      : z.union([z.literal(''), s])
  }
  return z.object(shape)
}
```

This one function replaces the hardcoded `clubName`/`ignTag` fields in `registration-schema.ts`, and is called from `register-service.ts`, `waitlist-service.ts`, and both mobile endpoints — the four duplicated copies collapse into one shared builder plus one shared field-fetch (`fetchRegistrationFields(admin, gameId)`, mirroring `fetchModeCatalogue()`).

`displayName` and `whatsapp` are **not** part of this catalogue — they're identity fields every registration needs regardless of game, and stay as their own fixed fields exactly as today.

### 4.4 Web rendering

`RegistrationPanel.tsx`'s `RegisterForm` and `WaitlistForm` stop rendering two hardcoded `<Field>`s. The tournament page fetches the game's active registration fields (ordered by `seq`) alongside its Mode/Format/Map catalogue data, and both forms map over them:

```tsx
{registrationFields.map((f) => (
  <Field
    key={f.fieldKey}
    name={f.fieldKey}
    label={f.required ? f.label : `${f.label} (optional)`}
    placeholder={f.placeholder ?? undefined}
    required={f.required}
  />
))}
```

### 4.5 Mobile API

`clubName`/`ignTag` are currently static zod fields in a fixed OpenAPI contract (`lib/mobile-api/endpoints/tournaments.ts`). Per the mobile-api-v1 conventions (`docs/superpowers/specs/2026-09-18-mobile-api-v1-conventions.md`), this becomes:

- **New endpoint**, via `defineEndpoint()`: `GET /api/mobile/v1/games/{id}/registration-fields` — returns the same field list the web form uses, so Flutter renders its own dynamic form.
- **Changed endpoints**: the register and waitlist POST bodies replace `clubName`/`ignTag` with `registrationDetails: Record<string, string>`, validated server-side with the same `buildRegistrationSchema()` against that tournament's game.
- `npm run openapi` regenerated and `openapi/mobile-v1.json` committed, per CLAUDE.md's mobile API rule — this is a breaking contract change, so it needs a note to the `sentinelx_mobile` repo (see `[[project_mobile_flutter_app_repo]]`-style handoff, not part of this spec's code).

## 5. Game Designer — admin UI

One page, `/admin/games/[id]`, replacing today's flat `/admin/games` (`GameForm.tsx` create-only + `GameRow.tsx` toggle-only). `/admin/games` becomes a list that links into each game's Designer page; the "Add a game" form stays as the quick-create entry point, landing on the new game's Designer page immediately after creation.

### 5.1 Sections

1. **Basics** — name, slug, category, icon, active (today's fields, unchanged behavior)
2. **Registration Fields** — table of this game's fields (label, key, type, required, pattern, show-on-bracket, active), add/edit/reorder/deactivate, with a live preview panel rendering exactly what the public registration form will show
3. **Modes** — list of this game's modes (name, competition format, active), add/edit/reorder/deactivate
4. **Per mode → Formats** — name, entry unit, team size, `available` toggle (the existing "coming soon, greyed, unselectable" flag)
5. **Per mode → Maps** — name, reorder, deactivate
6. **Per mode → Match Rules** — name, reorder, deactivate
7. **Match Types** (Bo1/Bo3/Bo5) — a small, separate, global section (not nested under a game) since `match_types` has no `game_id`

Sections 3–6 form a nested tree (Mode → its Formats/Maps/Match Rules); the page expands one mode at a time to manage its children, mirroring the same parent-child shape `TournamentForm.tsx` already reads.

### 5.2 New Server Actions

- `lib/games/registration-fields-actions.ts` — `createRegistrationField`, `updateRegistrationField`, `deleteRegistrationField`, `reorderRegistrationFields`
- `lib/games/mode-catalogue-actions.ts` — `createMode`/`updateMode`/`deleteMode`/`reorderModes`, `createFormat`/`updateFormat`/`deleteFormat`, `createMap`/`updateMap`/`deleteMap`, `createMatchRule`/`updateMatchRule`/`deleteMatchRule`

All follow the existing `lib/games/admin-actions.ts` pattern exactly: `await requireStaff()` then the **regular session client** (`createClient()`), not `createAdminClient()` — these tables already carry `is_staff()` RLS write policies, so they're not on CLAUDE.md's sensitive-tables list requiring service-role writes.

### 5.3 Deleting vs. deactivating

Deleting a mode/format/map/field that a past tournament references would orphan that tournament's `mode_id`/`format_id`/`default_map_id`/`match_rule_id` (all nullable FKs) or leave old `registration_details` keys undocumented. Actions therefore default to **deactivate** (`active = false`) when the row has any historical reference, and only allow a hard delete when nothing points to it — this mirrors the `available` flag's existing "coming soon, don't delete the option" philosophy from the 2026-09-12 design.

## 6. Rollout order

One integrated change, built and shipped together — not phased capability:

1. Schema: `game_registration_fields` table + `registration_details` jsonb migration (backfill + drop old columns)
2. Shared validation builder (`lib/tournaments/registration-fields.ts`) + `fetchRegistrationFields()`
3. Game Designer UI — all sections in §5, including the mode-catalogue actions (net-new CRUD on tables that already exist)
4. Web registration form rewire (`RegistrationPanel.tsx`, bracket view, admin registrations/results pages)
5. Mobile: new fields endpoint, `registrationDetails` body shape, OpenAPI regen
6. Re-seed Free Fire's and DLS's/EA FC Mobile's own registration fields **through the new Designer UI**, not a migration — the proof the UI works end to end, on real data

## 7. Testing

- `registration-fields.ts` (schema builder): unit tests for required/optional/pattern combinations, mirroring `lib/tournaments/registration-schema.test.ts`'s existing coverage style
- `registration-fields-actions.ts` / `mode-catalogue-actions.ts`: unit tests per action (create/update/delete/reorder, staff-gate, delete-vs-deactivate branching) — same shape as `lib/seasons/invitation-actions.ts`'s tests
- `register-service.test.ts` / `waitlist-service.test.ts`: update fixtures from `clubName`/`ignTag` to a `registrationDetails` map
- `lib/mobile-api/endpoints/tournaments.test.ts`: update for the new body shape + new fields endpoint
- One integration-style check: seed Free Fire's fields via the Designer UI in a test, then register for a Free Fire tournament and confirm `registration_details` round-trips correctly

## 8. Open questions

- None blocking. The one deferred design decision — whether `sentinelx_mobile` needs a coordinated release for the breaking `registrationDetails` body change — is a rollout-communication detail for the implementation plan, not an architecture question.
