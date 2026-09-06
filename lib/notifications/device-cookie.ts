// Name of the cookie holding THIS browser's FCM registration token.
//
// Exists because signOut() is a plain server action, used directly as a form
// action in three components, so it has no access to client state — and it
// must delete only the token belonging to the device it runs on. Every device
// has its own token row; deleting by player_id hit all of them.
//
// Not httpOnly-sensitive data: the token is already known to the client that
// generated it, and possessing it grants nothing beyond addressing pushes to
// that same browser. It is still set httpOnly so page scripts cannot clear it
// out from under the sign-out path.
export const DEVICE_TOKEN_COOKIE = 'sx_device_token'

// A year: FCM tokens are long-lived, and the cookie is rewritten on every
// successful registration anyway.
export const DEVICE_TOKEN_MAX_AGE = 60 * 60 * 24 * 365
