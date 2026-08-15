'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { MembershipTier } from '@/lib/membership/tiers'
import { SIZE_PX, BORDER_WIDTH_PX, hexHeight, type HexAvatarSize } from '@/lib/avatars/size'
import { resolveDecorations } from '@/lib/avatars/decorations'

const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'

const TIER_BORDER_COLOUR: Record<MembershipTier, string> = {
  recruit: '#64748B',
  guardian: '#3B82F6',
  elite: '#7C3AED',
  sentinel: '#F59E0B',
  legend: '', // uses .hexavatar-legend-border conic-gradient instead of a flat colour
}

const TIER_GLOW_CLASS: Record<MembershipTier, string> = {
  recruit: '',
  guardian: 'drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]',
  elite: 'drop-shadow-[0_0_12px_rgba(124,58,237,0.7)]',
  sentinel: 'drop-shadow-[0_0_16px_rgba(245,158,11,0.75)] animate-sentinel-pulse',
  legend: 'drop-shadow-[0_0_20px_rgba(239,68,68,0.8)] animate-legend-glow',
}

export interface HexAvatarProps {
  src: string | null
  username: string
  tier: MembershipTier
  /** Unlocked achievement slugs already in scope on the parent page — decorations are derived from these. */
  achievements?: string[]
  size?: HexAvatarSize
  /** Equipped `avatar_border` store cosmetic (a `ring-*`/`shadow-*` Tailwind class) — see lib/store/cosmetics.ts. */
  avatarBorderClass?: string
  className?: string
}

export function HexAvatar({
  src,
  username,
  tier,
  achievements = [],
  size = 'md',
  avatarBorderClass,
  className,
}: HexAvatarProps) {
  const [errored, setErrored] = useState(false)
  const widthPx = SIZE_PX[size]
  const heightPx = hexHeight(widthPx)
  const borderPx = BORDER_WIDTH_PX[tier]
  const showImage = src && !errored
  // Defensive against real rows with neither display_name nor username set —
  // callers type this as a required string, but runtime data isn't validated.
  const initials = (username || '?').slice(0, 2).toUpperCase()
  const { topRight, bottomRight } = resolveDecorations(achievements)
  const badgeSize = Math.max(14, Math.round(widthPx * 0.28))

  return (
    <div
      className={cn('relative inline-block shrink-0', TIER_GLOW_CLASS[tier], avatarBorderClass, className)}
      style={{ width: widthPx, height: heightPx }}
    >
      {/* Outer hex — the tier-coloured "border" */}
      <div
        className={cn('absolute inset-0', tier === 'legend' && 'hexavatar-legend-border')}
        style={{ clipPath: HEX_CLIP, backgroundColor: tier === 'legend' ? undefined : TIER_BORDER_COLOUR[tier] }}
      />
      {/* Inner hex — the avatar, inset by the tier's border width */}
      <div className="absolute overflow-hidden" style={{ clipPath: HEX_CLIP, inset: borderPx }}>
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URLs aren't in next.config's image domains
          <img
            src={src}
            alt={username}
            width={widthPx}
            height={heightPx}
            className="h-full w-full object-cover"
            onError={() => setErrored(true)}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-sx-surface font-display font-bold text-white"
            style={{ fontSize: Math.round(widthPx * 0.32) }}
          >
            {initials}
          </div>
        )}
      </div>

      {topRight && (
        <span
          className={cn(
            'absolute right-0 top-0 flex -translate-y-1/3 translate-x-1/3 items-center justify-center rounded-full ring-2 ring-white',
            topRight.colourClass,
          )}
          style={{ width: badgeSize, height: badgeSize, fontSize: Math.round(badgeSize * 0.6) }}
          title={topRight.slug}
        >
          {topRight.emoji}
        </span>
      )}
      {bottomRight && (
        <span
          className={cn(
            'absolute bottom-0 right-0 flex translate-y-1/3 translate-x-1/3 items-center justify-center rounded-full ring-2 ring-white',
            bottomRight.colourClass,
          )}
          style={{ width: badgeSize, height: badgeSize, fontSize: Math.round(badgeSize * 0.6) }}
          title={bottomRight.slug}
        >
          {bottomRight.emoji}
        </span>
      )}
    </div>
  )
}
