# SentinelX HexAvatar — Design Spec

**Date:** 2026-08-15  
**Status:** Approved → ready for implementation  
**Component:** `components/shared/HexAvatar.tsx`

---

## 1. Concept

Every player avatar on SentinelX is rendered inside a **hexagonal frame**. The hex shape is fixed — it's the SentinelX signature. What changes is the **frame** around it: colour, glow intensity, border weight, and animation all scale with the player's membership tier. Achievement decorations layer on top of the frame as small icon badges.

This means: at a glance, you can tell a Legend from a Recruit just by looking at their avatar — before reading a single word.

---

## 2. Tier Frame System

| Tier | Border colour | Glow | Animation | Border width |
|------|--------------|------|-----------|-------------|
| **Recruit** | `#64748B` (slate-500) | None | None | 2px |
| **Guardian** | `#3B82F6` (blue-500) | Subtle blue, 8px spread | None | 3px |
| **Elite** | `#7C3AED` (purple) | Purple, 12px spread | None | 3px |
| **Sentinel** | `#F59E0B` (amber-500) | Gold, 16px spread | Slow shimmer (3s ease-in-out pulse on glow opacity) | 4px |
| **Legend** | Animated gradient: `#EF4444` → `#F59E0B` → `#EF4444` | Intense red-gold, 20px spread | Border gradient rotates (6s linear infinite) + glow pulses | 4px |

---

## 3. Achievement Decorations

Small icon badges that sit on the outer edge of the hex frame. A player can have **at most two** decorations active at once (priority order below). They appear at the top-right and bottom-right vertices of the hexagon.

| Decoration | Trigger achievement | Icon | Position | Colour |
|-----------|-------------------|------|----------|--------|
| 👑 Champion Crown | `first_champion` | Crown SVG | Top-right vertex | Gold |
| 🔥 Triple Crown | `champion_3x` | Triple flame SVG | Top-right vertex | Orange-gold gradient |
| ⭐ Masters Champion | `masters_champion` | Gold star | Top-right vertex | Gold |
| 💎 Cup Legend | `champions_cup_champion` | Diamond SVG | Top-right vertex | Cyan-gold gradient |
| ⚡ Streak | `win_streak_5` | Lightning bolt | Bottom-right vertex | Purple |
| 🛡 Veteran | `matches_100` | Shield | Bottom-right vertex | Slate-blue |

Priority (top-right slot): Cup Legend > Masters Champion > Triple Crown > Champion Crown  
Priority (bottom-right slot): Streak > Veteran

The decoration is a 20×20px SVG circle badge with white icon inside, sitting on the hex vertex with a 2px white ring to separate it from the frame.

---

## 4. Sizes

| Size key | Avatar hex diameter | Use case |
|----------|-------------------|----------|
| `xs` | 28px | Leaderboard rows, comment avatars |
| `sm` | 40px | Match cards, opponent avatars |
| `md` | 56px | Profile header sidebar, rankings |
| `lg` | 80px | Dashboard hero, player profile page |
| `xl` | 112px | Hall of Fame champion cards |

---

## 5. Implementation

### 5.1 Component interface

```tsx
// components/shared/HexAvatar.tsx
interface HexAvatarProps {
  src: string | null           // avatar_url from profiles; null → initials fallback
  username: string             // for initials fallback + alt text
  tier: MembershipTier         // 'recruit' | 'guardian' | 'elite' | 'sentinel' | 'legend'
  achievements?: string[]      // list of unlocked achievement slugs — decorations derived from this
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}
```

### 5.2 Hex clip-path

Use CSS `clip-path: polygon(...)` for the hexagonal crop. A regular hexagon (flat-top orientation — wider than tall):

```css
clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
```

For the frame: render a slightly larger outer div with the same clip-path, coloured with the tier border colour, then the avatar image div inside it — the "border" is the visible gap between the two hex layers.

```tsx
// Pseudo-structure
<div className="relative inline-block" style={{ width: size, height: size * 0.866 }}>
  {/* Outer hex — the "border" */}
  <div
    className={cn('absolute inset-0', tierGlowClass[tier])}
    style={{ clipPath: HEX_CLIP, backgroundColor: tierBorderColour[tier] }}
  />
  {/* Inner hex — the avatar, inset by border width */}
  <div
    className="absolute"
    style={{
      clipPath: HEX_CLIP,
      inset: BORDER_WIDTH[tier],
    }}
  >
    {src ? (
      <Image src={src} alt={username} fill className="object-cover" />
    ) : (
      <div className={cn('flex h-full w-full items-center justify-center bg-sx-surface', initialsClass)}>
        {username.slice(0, 2).toUpperCase()}
      </div>
    )}
  </div>

  {/* Achievement decorations */}
  {topRightDecoration && (
    <AchievementBadge decoration={topRightDecoration} position="top-right" size={size} />
  )}
  {bottomRightDecoration && (
    <AchievementBadge decoration={bottomRightDecoration} position="bottom-right" size={size} />
  )}
</div>
```

### 5.3 Glow effect

Applied via Tailwind `drop-shadow` on the outer wrapper (not the inner clip-path div, which clips the shadow):

```ts
const tierGlowClass: Record<MembershipTier, string> = {
  recruit:  '',
  guardian: 'drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]',
  elite:    'drop-shadow-[0_0_12px_rgba(124,58,237,0.7)]',
  sentinel: 'drop-shadow-[0_0_16px_rgba(245,158,11,0.75)] animate-sentinel-pulse',
  legend:   'drop-shadow-[0_0_20px_rgba(239,68,68,0.8)] animate-legend-glow',
}
```

Add to `tailwind.config.ts`:
```ts
animation: {
  'sentinel-pulse': 'sentinelPulse 3s ease-in-out infinite',
  'legend-glow': 'legendGlow 6s linear infinite',
},
keyframes: {
  sentinelPulse: {
    '0%, 100%': { filter: 'drop-shadow(0 0 16px rgba(245,158,11,0.75))' },
    '50%':      { filter: 'drop-shadow(0 0 24px rgba(245,158,11,1))' },
  },
  legendGlow: {
    '0%':   { filter: 'drop-shadow(0 0 20px rgba(239,68,68,0.8))' },
    '50%':  { filter: 'drop-shadow(0 0 24px rgba(245,158,11,0.9))' },
    '100%': { filter: 'drop-shadow(0 0 20px rgba(239,68,68,0.8))' },
  },
}
```

Legend animated border gradient: use a CSS `@keyframes` rotating `conic-gradient` on the outer hex div (requires a small inline `<style>` tag or a global CSS addition since Tailwind can't animate conic gradients natively).

### 5.4 Initials fallback

When `src` is null or the image fails to load (`onError`): render the player's first two characters of `username` in uppercase, in the tier colour, on `bg-sx-surface`. Font: Barlow Condensed Bold.

### 5.5 Sizes in px

```ts
const SIZE_PX: Record<HexAvatarSize, number> = {
  xs:  28,
  sm:  40,
  md:  56,
  lg:  80,
  xl: 112,
}
// Height of a flat-top hex = width * (√3/2) ≈ width * 0.866
// Border widths match tier table in §2
const BORDER_WIDTH_PX: Record<MembershipTier, number> = {
  recruit: 2, guardian: 3, elite: 3, sentinel: 4, legend: 4,
}
```

---

## 6. Where to use HexAvatar

Replace every existing circular avatar (`<Avatar>`, `<img className="rounded-full">`, etc.) with `<HexAvatar>` at these locations:

| Location | Size | Tier source |
|----------|------|-------------|
| Dashboard hero (`HeroIdentityPanel`) | `lg` | Own `profiles.membership_tier` |
| Dashboard `NextMatchCard` (self + opponent) | `sm` | Each player's `membership_tier` |
| Player profile header | `xl` | Profile's `membership_tier` |
| Leaderboard rows | `xs` | Row's `membership_tier` |
| Hall of Fame champion cards | `xl` | Player's `membership_tier` |
| Hall of Fame award cards | `lg` | Player's `membership_tier` |
| Rankings page rows | `xs` | Row's `membership_tier` |
| Match Centre (player A vs B) | `md` | Each player's `membership_tier` |
| Admin player list | `xs` | Profile's `membership_tier` |

---

## 7. Achievement Decoration Source

`HexAvatar` receives `achievements?: string[]` (array of unlocked slugs). The decoration priority logic lives in a pure helper:

```ts
// lib/avatars/decorations.ts
export function resolveDecorations(slugs: string[]): {
  topRight: AchievementDecoration | null
  bottomRight: AchievementDecoration | null
}
```

Unit tested independently. The component stays pure — it doesn't fetch achievement data; the parent page passes down the slugs it already has in scope.

---

## 8. Testing

- Unit test `resolveDecorations`: multiple overlapping achievements, correct priority selection, empty array returns all null.
- Unit test size calculations: hex height = `SIZE_PX * 0.866` for each size key.
- Visual regression: snapshot test for each tier at `md` size (initials fallback, no achievements).
- Confirm no Cumulative Layout Shift: `HexAvatar` must declare explicit `width`/`height` to prevent layout shift on image load.
