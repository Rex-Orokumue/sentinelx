import { ImageResponse } from 'next/og'
import { OG_SIZE } from './template'
import { initialsFrom } from '@/lib/nav/tabs'
import type { CardPlayer, HypeCardInput, ResultCardInput } from './match-card-data'

function playerLabel(p: CardPlayer): string {
  return p.displayName ?? p.username ?? 'TBD'
}

// Satori (the next/og renderer) can't parse variable fonts and doesn't take
// Tailwind classes — every style here is inline, matching the constraint
// already documented in lib/og/template.tsx.
function PlayerBlock({ player, highlight }: { player: CardPlayer; highlight: boolean }) {
  const ringColor = highlight ? '#34d399' : '#1e293b'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: 320 }}>
      {player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.avatarUrl}
          width={120}
          height={120}
          style={{ borderRadius: '50%', objectFit: 'cover', border: `4px solid ${ringColor}` }}
        />
      ) : (
        <div
          style={{
            display: 'flex',
            width: 120,
            height: 120,
            borderRadius: '50%',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#334155',
            color: '#ffffff',
            fontSize: 44,
            fontWeight: 700,
            border: `4px solid ${ringColor}`,
          }}
        >
          {initialsFrom(player.displayName, player.username)}
        </div>
      )}
      <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: '#ffffff', textAlign: 'center' }}>
        {playerLabel(player)}
      </div>
      {highlight && (
        <div style={{ display: 'flex', fontSize: 18, fontWeight: 700, color: '#34d399', letterSpacing: '0.15em' }}>
          WINNER
        </div>
      )}
    </div>
  )
}

function CardShell({
  tournamentTitle,
  children,
}: {
  tournamentTitle: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#020617',
        padding: '60px',
      }}
    >
      <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, letterSpacing: '0.1em', color: '#a78bfa' }}>
        SENTINEL X
      </div>
      <div style={{ display: 'flex', fontSize: 22, color: '#94a3b8', marginTop: 8, marginBottom: 40 }}>
        {tournamentTitle}
      </div>
      {children}
    </div>
  )
}

function renderHype(input: HypeCardInput) {
  return new ImageResponse(
    (
      <CardShell tournamentTitle={input.tournamentTitle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <PlayerBlock player={input.playerA} highlight={false} />
          <div style={{ display: 'flex', fontSize: 48, fontWeight: 900, color: '#475569' }}>VS</div>
          <PlayerBlock player={input.playerB} highlight={false} />
        </div>
        {input.scheduledLabel && (
          <div style={{ display: 'flex', fontSize: 24, color: '#94a3b8', marginTop: 40 }}>{input.scheduledLabel}</div>
        )}
      </CardShell>
    ),
    OG_SIZE,
  )
}

function renderResult(input: ResultCardInput) {
  return new ImageResponse(
    (
      <CardShell tournamentTitle={input.tournamentTitle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <PlayerBlock player={input.playerA} highlight={input.winnerSide === 'player_a'} />
          <div style={{ display: 'flex', fontSize: 56, fontWeight: 900, color: '#ffffff' }}>
            {input.scoreA} – {input.scoreB}
          </div>
          <PlayerBlock player={input.playerB} highlight={input.winnerSide === 'player_b'} />
        </div>
      </CardShell>
    ),
    OG_SIZE,
  )
}

export function renderMatchCard(input: HypeCardInput | ResultCardInput) {
  return input.variant === 'result' ? renderResult(input) : renderHype(input)
}
