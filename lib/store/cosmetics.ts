// Visual mapping for each of the 13 seeded store items (supabase/migrations/052_sx_coins_store.sql).
// bubble_skin is deliberately excluded — out of scope, see plan
// docs/superpowers/plans/2026-08-15-phase2-postship-fixes.md Task 4.1.
// Avatar borders are illustrated frames (public/coin-items/*.webp), not CSS
// rings. They replaced ring classes once real artwork existed — a ring cannot
// represent a crown, a banner or flames, and the shop preview would then have
// promised something the equipped item didn't deliver.
//
// Transparent WebP: the source art is opaque JPEG, converted with alpha keyed
// from the background (white-backed art by distance-to-white, glow-on-black art
// by luminance). WebP over PNG because the set is 1.2MB instead of 3.2MB, which
// matters on the mobile data these players actually pay for.
export const AVATAR_BORDER_FRAMES: Record<string, string> = {
  avatar_border_bronze: '/coin-items/bronze-frame.webp',
  avatar_border_purple_glow: '/coin-items/purple-glow.webp',
  avatar_border_gold_crown: '/coin-items/gold-crown.webp',
  avatar_border_champion: '/coin-items/champion-frame.webp',
  avatar_border_cyber_core: '/coin-items/cyber-core.webp',
  avatar_border_diamond_edge: '/coin-items/diamond-edge.webp',
  avatar_border_legendary_sx: '/coin-items/legendary-SX.webp',
  avatar_border_mythic_sentinel: '/coin-items/mythic-sentinel.webp',
  avatar_border_neon_pulse: '/coin-items/neon-pulse.webp',
  avatar_border_shadow_flame: '/coin-items/shadow-flame.webp',
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
// slug up in the maps above (AVATAR_BORDER_FRAMES for a frame image, the
// *_CLASSES maps for Tailwind classes) to get the actual visual;
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
