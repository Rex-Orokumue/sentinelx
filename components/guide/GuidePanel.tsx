'use client'
import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Avatar } from '@/components/shared/Avatar'
import { PILLARS } from '@/components/home/FourPillars'
import { STEPS } from '@/components/home/HowItWorks'
import { getQuestStatus, claimBattleReadyBadge } from '@/lib/guide/actions'
import type { QuestStatus } from '@/lib/guide/quest-status'
import { Spotlight } from './Spotlight'

type QuestKey = 'profileComplete' | 'firstTournamentEntered' | 'firstMatchCompleted'

const QUEST_STEPS: Array<{ key: QuestKey; label: string; href: string; targetId: string; spotlightBody: string }> = [
  {
    key: 'profileComplete',
    label: 'Complete your profile',
    href: '/dashboard/settings',
    targetId: 'guide-target-profile',
    spotlightBody: 'Set your username and avatar right here.',
  },
  {
    key: 'firstTournamentEntered',
    label: 'Enter your first tournament',
    href: '/tournaments',
    targetId: 'guide-target-tournaments',
    spotlightBody: 'Pick any open tournament below and register to compete.',
  },
  {
    key: 'firstMatchCompleted',
    label: 'Complete your first match',
    href: '/dashboard/matches',
    targetId: 'guide-target-matches',
    spotlightBody: 'Your active fixtures show up here once you register.',
  },
]

export function GuidePanel({
  isLoggedIn,
  username,
  avatarUrl,
  onClose,
}: {
  isLoggedIn: boolean
  username: string | null
  avatarUrl: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const [visitorSlide, setVisitorSlide] = useState(0)
  const [status, setStatus] = useState<QuestStatus | null>(null)
  const [alreadyClaimed, setAlreadyClaimed] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [spotlightStep, setSpotlightStep] = useState<(typeof QUEST_STEPS)[number] | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!isLoggedIn) return
    let cancelled = false
    getQuestStatus().then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setLoadError(true)
        return
      }
      setStatus(res.status)
      setAlreadyClaimed(res.alreadyClaimed)
    })
    return () => {
      cancelled = true
    }
  }, [isLoggedIn])

  function handleClaim() {
    startTransition(async () => {
      const res = await claimBattleReadyBadge()
      if (!res.ok) {
        setClaimError(res.error)
        return
      }
      setAlreadyClaimed(true)
      router.refresh()
    })
  }

  function targetOnPage(targetId: string): boolean {
    return typeof document !== 'undefined' && !!document.getElementById(targetId)
  }

  const doneCount = status
    ? [status.profileComplete, status.firstTournamentEntered, status.firstMatchCompleted].filter(Boolean).length
    : 0

  const panel = (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute bottom-0 right-0 flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-2xl border-t border-sx-purple/30 bg-sx-bg shadow-2xl sm:bottom-6 sm:right-6 sm:max-h-[70vh] sm:w-96 sm:rounded-2xl sm:border">
        <div className="flex items-center justify-between border-b border-sx-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border-2 border-sx-purple/50 bg-sx-bg">
              <Image src="/mascot/mascot-bubble.png" alt="Sentinel" fill sizes="32px" className="object-cover object-top" />
            </div>
            <p className="text-sm font-bold text-white">Sentinel Guide</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="text-slate-400 transition-colors hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 p-4">
          {!isLoggedIn ? (
            <VisitorTour
              slide={visitorSlide}
              onNext={() => setVisitorSlide((s) => Math.min(3, s + 1))}
              onBack={() => setVisitorSlide((s) => Math.max(0, s - 1))}
            />
          ) : loadError ? (
            <p className="py-8 text-center text-sm text-sx-gray">Couldn&apos;t load your progress. Try again shortly.</p>
          ) : !status ? (
            <p className="py-8 text-center text-sm text-sx-gray">Loading your quest…</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5">
                <Avatar avatarUrl={avatarUrl} displayName={null} username={username} size={32} />
                <p className="text-sm font-bold text-white">Hey {username ?? 'Gamer'}! 👋</p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-bold uppercase text-white">Battle Ready Quest</span>
                  <span className="text-sx-gray">{doneCount}/3</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-sx-purple transition-all"
                    style={{ width: `${(doneCount / 3) * 100}%` }}
                  />
                </div>
              </div>

              <ul className="space-y-2">
                {QUEST_STEPS.map((step) => {
                  const done = status[step.key]
                  return (
                    <li
                      key={step.key}
                      className="flex items-center justify-between gap-3 rounded-xl border border-sx-border bg-sx-surface p-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            done ? 'bg-sx-green text-white' : 'bg-slate-700 text-sx-gray'
                          }`}
                        >
                          {done ? '✓' : ''}
                        </span>
                        <span className={`text-sm ${done ? 'text-sx-gray line-through' : 'text-white'}`}>{step.label}</span>
                      </div>
                      {!done &&
                        (targetOnPage(step.targetId) ? (
                          <button
                            type="button"
                            onClick={() => setSpotlightStep(step)}
                            className="shrink-0 text-xs font-bold text-sx-purple-text hover:underline"
                          >
                            Show me
                          </button>
                        ) : (
                          <Link
                            href={step.href}
                            onClick={onClose}
                            className="shrink-0 text-xs font-bold text-sx-purple-text hover:underline"
                          >
                            Take me there
                          </Link>
                        ))}
                    </li>
                  )
                })}
              </ul>

              {status.allComplete &&
                (alreadyClaimed ? (
                  <p className="rounded-xl border border-sx-green/40 bg-sx-green/10 p-3 text-center text-sm font-bold text-sx-green">
                    Badge earned ✓
                  </p>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={handleClaim}
                      disabled={pending}
                      className="w-full rounded-xl bg-sx-purple px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light disabled:opacity-60"
                    >
                      {pending ? 'Claiming…' : '🏆 Claim Your Badge'}
                    </button>
                    {claimError && <p className="mt-2 text-xs text-red-400">{claimError}</p>}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {createPortal(panel, document.body)}
      {spotlightStep && (
        <Spotlight
          targetId={spotlightStep.targetId}
          title={spotlightStep.label}
          body={spotlightStep.spotlightBody}
          onDismiss={() => setSpotlightStep(null)}
        />
      )}
    </>
  )
}

function VisitorTour({ slide, onNext, onBack }: { slide: number; onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex min-h-[220px] flex-col">
      <div className="flex-1">
        {slide === 0 && (
          <div className="space-y-2 py-4 text-center">
            <p className="font-display text-xl font-black uppercase text-white">What is SentinelX?</p>
            <p className="text-sm leading-relaxed text-sx-gray">
              Nigeria&apos;s home of mobile esports — compete in tournaments, watch live finals, connect with the
              community, and trade gaming accounts safely, all in one place.
            </p>
          </div>
        )}
        {slide === 1 && (
          <div className="space-y-2 py-2">
            <p className="mb-2 text-center font-display text-lg font-black uppercase text-white">The Four Pillars</p>
            {PILLARS.map((p) => (
              <div key={p.name} className="flex items-center gap-2.5 rounded-lg border border-sx-border bg-sx-surface p-2.5">
                <span className="text-lg">{p.emoji}</span>
                <div>
                  <p className="text-sm font-bold text-white">{p.name}</p>
                  <p className="text-xs text-sx-gray">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {slide === 2 && (
          <div className="space-y-1.5 py-2">
            <p className="mb-2 text-center font-display text-lg font-black uppercase text-white">How Tournaments Work</p>
            {STEPS.map((s) => (
              <div key={s.num} className="flex items-center gap-2.5 rounded-lg border border-sx-border bg-sx-surface p-2">
                <span className="text-base">{s.icon}</span>
                <p className="text-xs font-semibold text-white">{s.title}</p>
              </div>
            ))}
          </div>
        )}
        {slide === 3 && (
          <div className="space-y-3 py-6 text-center">
            <p className="font-display text-xl font-black uppercase text-white">Ready to Compete?</p>
            <p className="text-sm text-sx-gray">Create your free account and enter your first tournament today.</p>
            <Link
              href="/signup"
              className="inline-block rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light"
            >
              Sign Up Free →
            </Link>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-sx-border pt-3">
        <button type="button" onClick={onBack} disabled={slide === 0} className="text-xs font-bold text-sx-gray disabled:opacity-30">
          ← Back
        </button>
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === slide ? 'bg-sx-purple' : 'bg-slate-700'}`} />
          ))}
        </div>
        {slide < 3 ? (
          <button type="button" onClick={onNext} className="text-xs font-bold text-sx-purple-text">
            Next →
          </button>
        ) : (
          <span className="w-8" />
        )}
      </div>
    </div>
  )
}
