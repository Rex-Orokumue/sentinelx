import { initialsFrom } from '@/lib/nav/tabs'

// Renders the user's avatar image when set, otherwise initials on a neutral circle.
// A plain <img> avoids next/image remote-host config for Supabase storage URLs.
export function Avatar({
  avatarUrl,
  displayName,
  username,
  size = 28,
  className = '',
}: {
  avatarUrl: string | null
  displayName: string | null
  username: string | null
  size?: number
  className?: string
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    )
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-slate-700 font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsFrom(displayName, username)}
    </span>
  )
}
