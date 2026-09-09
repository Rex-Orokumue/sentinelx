import { initialsFrom } from '@/lib/nav/tabs'

// Renders the user's avatar image when set, otherwise initials on a neutral circle.
// A plain <img> avoids next/image remote-host config for Supabase storage URLs.
// Frame size relative to the avatar's width, matching HexAvatar's FRAME_SCALE
// so a player's frame reads the same everywhere it appears — the round avatar
// in the header and the hex on their profile are the same cosmetic.
const FRAME_SCALE = 1.55

export function Avatar({
  avatarUrl,
  displayName,
  username,
  size = 28,
  className = '',
  frameUrl,
}: {
  avatarUrl: string | null
  displayName: string | null
  username: string | null
  size?: number
  className?: string
  /** Equipped `avatar_border` store cosmetic — an illustrated frame image from
   *  AVATAR_BORDER_FRAMES (lib/store/cosmetics.ts), drawn around the avatar. */
  frameUrl?: string
}) {
  const inner = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  ) : (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-slate-700 font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsFrom(displayName, username)}
    </span>
  )

  // No frame equipped: return the bare avatar rather than wrapping it, so every
  // existing layout that positions this element keeps behaving identically.
  if (!frameUrl) return inner

  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      {inner}
      {/* Deliberately unclipped and larger than the avatar — these frames have
          crowns and banners that break the circle. Decorative only, so it is
          hidden from assistive tech and ignores pointer events. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static public asset, no loader needed */}
      <img
        src={frameUrl}
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 select-none"
        style={{ width: size * FRAME_SCALE, height: size * FRAME_SCALE }}
      />
    </span>
  )
}
