import { PILLAR_LINKS, type PillarLink } from './links'

export type TabDef = PillarLink

// The four product pillars, from the single nav source of truth. The Account
// tab is auth-dependent and handled in the component.
export const PILLAR_TABS: TabDef[] = PILLAR_LINKS

// A tab owns its route and everything nested under it.
export function isTabActive(tab: { href: string }, pathname: string): boolean {
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`)
}

export function initialsFrom(displayName: string | null, username: string | null): string {
  const source = (displayName ?? username ?? '').trim()
  if (!source) return '?'
  const parts = source.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}
