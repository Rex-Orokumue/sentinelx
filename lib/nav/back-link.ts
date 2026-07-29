export interface BackLink {
  href: string
  label: string
}

// A page reachable from several places needs its "← back" to point at wherever
// the visitor actually came from. Entry points tag their link with `?from=<key>`;
// this resolves that key against a per-page map of allowed destinations.
//
// `from` is a whitelisted key, never a raw path — a caller-supplied href would
// be an open-redirect vector. An unknown or missing key falls back, so a
// directly-opened or shared link still gets a sensible back target.
export function resolveBackLink(
  from: string | string[] | undefined,
  targets: Record<string, BackLink>,
  fallback: BackLink,
): BackLink {
  if (typeof from !== 'string') return fallback
  return targets[from] ?? fallback
}
