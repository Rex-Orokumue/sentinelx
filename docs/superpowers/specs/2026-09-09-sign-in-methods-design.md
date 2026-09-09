# Sign-in Methods — design

**Date:** 2026-09-09
**Status:** approved, implementing

## Why

Changing an email address does not revoke access from the Google account that
signed the user up. OAuth identities are keyed by the provider's stable subject
ID, not by the email address:

| provider | `provider_id` | matches on email? |
|----------|---------------|-------------------|
| google   | 21-digit Google subject ID | no |
| email    | UUID | no |

The `identity_data->>'email'` on a Google identity is a label Google sent, not a
key. So after an email change the old Google account still opens the same door,
and `auth.users.email` is left untouched by a later Google sign-in (verified
2026-09-09: sign-in at 09:00:45 did not revert the changed address).

That contradicts the reasoning behind the email-change feature itself — "the
usual reason to change an address is that the old one is unreachable". Someone
changing their address to get away from an inbox another person can reach would
reasonably assume the old address is now powerless. It is not, if that address
is a Google account.

There is no way to sever that link in the app today. This adds one, and the
inverse (linking Google to a password account) alongside it.

## Reach

Measured on production, 2026-09-09 (106 accounts):

| | count |
|---|---|
| Google + email identities — can unlink today | 8 |
| Password only — can link | 60 |
| Google only — neither | 42 |
| Password hash but no `email` identity | 4 |

Unlink is immediately usable by 8 accounts and grows with every completed email
change (confirming one mints the `email` identity). Linking is the broader half.

## Scope

In: list sign-in methods, unlink Google, link Google, a note at email-change
time that Google sign-in survives the change.

Out: unlinking email/password (there is no second factor to fall back on);
other OAuth providers (only Google is configured); admin-side identity
management.

## Design

### Reading state

`supabase.auth.getUserIdentities()` in the settings Server Component. No new
table, no new column — `auth.identities` already holds exactly this.

### Unlink

`unlinkGoogle()` in a new `lib/auth/identities.ts` (kept out of `lib/auth/actions.ts`,
which is already long):

1. Require the current password, checked with the existing `verifyPassword()`
   from `lib/auth/reauth.ts`. This does two jobs with one mechanism: it proves
   the session belongs to the account holder, and it proves a working password
   exists — so removing Google cannot strand anyone.
2. Refuse below two identities. Supabase refuses this too; the local check
   exists to return a translated message instead of a raw API error.
3. `unlinkIdentity(googleIdentity)`.
4. `signOut({ scope: 'others' })`. Unlinking is a "lock the other person out"
   action; leaving their live session running until it expires defeats it. The
   current device stays signed in.

Returns error codes, not prose, matching `changeEmail()` and
`requestAccountDeletion()`.

### Link

Client-side, because it needs a browser redirect:

```ts
supabase.auth.linkIdentity({
  provider: 'google',
  options: { redirectTo: `${origin}/auth/oauth/callback?next=/dashboard/settings?linked=google` },
})
```

`app/auth/oauth/callback/route.ts` already exchanges the PKCE code, and
`resolveCallbackRedirect` already accepts a `next` with a query string, so the
happy path needs no route change.

The failure path does. Linking a Google account that already belongs to another
SentinelX user returns `identity_already_exists`, and the callback currently
sends every failure to `/login?error=auth` — which reads as "you have been
signed out" to someone who is signed in and merely tried to link. When the
callback carries an `intent=link` marker, failures go back to
`/dashboard/settings?linked=error` instead.

**Requires "Manual Linking" enabled in the Supabase dashboard**
(Authentication → Sign In / Providers). GoTrue gates BOTH endpoints behind this
one toggle: with it off, `linkIdentity` and `unlinkIdentity` alike return
`404 manual_linking_disabled`. An earlier draft of this spec claimed unlink was
unaffected — it is not, confirmed against auth logs on 2026-09-09.

### UI

New `components/settings/SignInMethodsSection.tsx` — `AccountSection.tsx` is
already ~300 lines and does three unrelated jobs.

```
SIGN-IN METHODS
  Google    Linked · name@gmail.com        [Unlink]
  Email     name@gmail.com
```

Unlink expands a password-confirm form inline, like the email-change panel.
Mobile-first at 375px: rows stack, buttons full-width below `sm`.

When Google is the only identity, the unlink control is not offered and a line
explains that it is the only way into the account.

### Unlink does not hold on its own

GoTrue links an OAuth identity to an existing account automatically whenever the
provider returns a **verified** email matching that account's confirmed address.
So an unlink only sticks while the two addresses differ. Observed on 2026-09-09:
the Google identity was deleted at 14:06 and recreated at 14:23 by a single
Google sign-in, same subject ID, because the account had been changed back to
the Google address.

| account email vs Google email | Google sign-in yields |
|---|---|
| same | the same account — link silently restored |
| different | a new, empty account; the original stays shut |

Unlink and change-email therefore close the door only **together**. `willGoogleRelink()`
in `lib/auth/relink.ts` detects the matching case and the unlink form says so
outright, because an unlink that quietly undoes itself is worse than none — it
is a protection someone would rely on.

Blocking the re-link in `/auth/oauth/callback` was considered and rejected: it
fights GoTrue's automatic linking and introduces a way for a legitimate user to
lock themselves out of Google sign-in, in exchange for a guarantee that a
changed email already provides.

## Known limitation

Unlink requires two identities. The 4 accounts holding a password hash but no
`email` identity have only a Google identity, so Supabase will refuse to unlink
even though they would keep access through their password. They must complete
an email change first, which is what creates the `email` identity.

Writing directly to `auth.identities` to work around this is rejected —
hand-editing auth tables risks locking people out of their accounts for a
cosmetic gain on 4 rows.

## Testing

- unlink: wrong password refuses; single identity refuses; success calls
  `unlinkIdentity` then `signOut({ scope: 'others' })` in that order
- `resolveCallbackRedirect` passes `/dashboard/settings?linked=google` through
- callback sends link failures to settings, sign-in failures to `/login`
- locale key parity across en/fr/pcm

## Rollout

Both halves are inert until Manual Linking is enabled — see the note above.
`manual_linking_disabled` maps to its own message rather than the generic
"try again", which is untrue for a configuration failure.
