'use client'
import Image from 'next/image'
import { Chakra_Petch } from 'next/font/google'
import styles from './NavTransitionOverlay.module.css'

// Scoped to this one component per spec §2 — the rest of the site keeps
// Barlow Condensed. Only the weight the overlay actually uses.
const chakraPetch = Chakra_Petch({ weight: ['700'], subsets: ['latin'] })

const SHARD_COUNT = 6
const SHARD_STAGGER_MS = 55
const STATUS = ['LINKING NODE', 'DECRYPTING', 'LOADING ASSETS', 'SYNCING SQUAD', 'DEPLOYING']

export function NavTransitionOverlay({
  phase,
  pct,
  targetLabel,
}: {
  phase: 'cover' | 'reveal'
  pct: number
  targetLabel: string
}) {
  const reveal = phase === 'reveal'
  const statusText = STATUS[Math.min(STATUS.length - 1, Math.floor(pct / 21))]
  const revealCls = reveal ? styles.reveal : ''

  return (
    <div className={styles.overlay} aria-hidden="true">
      {Array.from({ length: SHARD_COUNT }, (_, i) => {
        // Reveal restarts the stagger from the opposite end — rightmost
        // shard leaves first, mirroring the entering wave. Spec §1.1.A.
        const delay = (reveal ? SHARD_COUNT - 1 - i : i) * SHARD_STAGGER_MS
        const accentTinted = i % 2 === 0
        return (
          <div
            key={i}
            className={`${styles.shard} ${reveal ? styles.shardReveal : styles.shardCover}`}
            style={{
              left: `calc(${(i / SHARD_COUNT) * 100}% - 3%)`,
              width: `calc(${100 / SHARD_COUNT}% + 6%)`,
              background: accentTinted
                ? 'linear-gradient(175deg, rgba(124,58,237,0.13) 0%, #0a0610 62%)'
                : 'linear-gradient(175deg, #12081f 0%, #0a0610 100%)',
              animationDelay: `${delay}ms`,
            }}
          />
        )
      })}

      <div className={styles.core}>
        <div className={`${styles.shockRing} ${styles.shockRing1} ${revealCls}`} />
        <div className={`${styles.shockRing} ${styles.shockRing2} ${revealCls}`} />
        <Image src="/logo.png" alt="" width={412} height={384} priority className={`${styles.logo} ${revealCls}`} />
        <div className={`${styles.label} ${chakraPetch.className} ${revealCls}`}>{targetLabel}</div>
        <div className={`${styles.barWrap} ${revealCls}`}>
          <div className={styles.bar} />
          <div className={styles.sweep} />
        </div>
        <div className={`${styles.pct} ${chakraPetch.className} ${revealCls}`}>
          {pct}
          <span className={styles.pctPercentSign}>%</span>
          <span className={styles.pctStatus}>{statusText}</span>
        </div>
      </div>

      <div className={`${styles.flash} ${revealCls}`} />
    </div>
  )
}
