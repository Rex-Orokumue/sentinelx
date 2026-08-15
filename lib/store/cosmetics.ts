// Visual mapping for each of the 13 seeded store items (supabase/migrations/052_sx_coins_store.sql).
// bubble_skin is deliberately excluded — out of scope, see plan
// docs/superpowers/plans/2026-08-15-phase2-postship-fixes.md Task 4.1.
export const AVATAR_BORDER_CLASSES: Record<string, string> = {
  avatar_border_bronze: 'ring-4 ring-amber-700',
  avatar_border_purple_glow: 'ring-4 ring-sx-purple shadow-[0_0_16px_2px_rgba(124,58,237,0.55)]',
  avatar_border_gold_crown: 'ring-4 ring-amber-400 shadow-[0_0_16px_2px_rgba(251,191,36,0.5)]',
}

export const PROFILE_THEME_CLASSES: Record<string, string> = {
  theme_dark_void: 'bg-black',
  theme_neon_grid:
    'bg-[linear-gradient(rgba(124,58,237,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(124,58,237,0.12)_1px,transparent_1px)] bg-[size:22px_22px] bg-slate-950',
  theme_lagos_skyline: 'bg-gradient-to-b from-orange-950 via-slate-900 to-slate-950',
}

export const USERNAME_COLOUR_CLASSES: Record<string, string> = {
  username_purple: 'text-sx-purple-text',
  username_gold: 'text-amber-400',
  username_red: 'text-red-400',
  username_teal: 'text-teal-400',
}

interface EquippedRow {
  item_id: string
  equipped: boolean
  store_items: { slug: string; category: string } | { slug: string; category: string }[] | null
}

export interface EquippedCosmetics {
  avatarBorder: string | null
  profileTheme: string | null
  usernameColour: string | null
}

// Pure — unit tested directly. Resolves the *slug* of the one equipped item
// per relevant category (bubble_skin excluded, see plan). Callers look the
// slug up in the *_CLASSES maps above to get the actual Tailwind classes;
// an equipped slug with no map entry (e.g. a future item added to the store
// without a matching visual yet) resolves to no visual change, not a crash.
export function equippedCosmeticsBySlug(rows: EquippedRow[]): EquippedCosmetics {
  const result: EquippedCosmetics = { avatarBorder: null, profileTheme: null, usernameColour: null }
  for (const row of rows) {
    if (!row.equipped) continue
    const item = Array.isArray(row.store_items) ? row.store_items[0] : row.store_items
    if (!item) continue
    if (item.category === 'avatar_border') result.avatarBorder = item.slug
    else if (item.category === 'profile_theme') result.profileTheme = item.slug
    else if (item.category === 'username_colour') result.usernameColour = item.slug
  }
  return result
}
