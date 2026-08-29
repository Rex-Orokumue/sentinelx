'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  isInterceptableLinkClick,
  isNavigationSettled,
  shouldPlayTransition,
  type LinkClickInfo,
} from '@/lib/nav/transition-guard'
import { NavTransitionOverlay } from './NavTransitionOverlay'

// Spec §3.2. The cover animation always runs at least this long even for an
// instantly-ready destination (so a fast page never feels rushed); if the
// destination isn't ready yet, this is a floor, not a ceiling — tryReveal
// keeps re-checking until it is.
const MIN_COVER_MS = 1400
// ...but it IS a hard ceiling. Readiness is detected from useTransition's
// pending flag (clicks) or an exact URL match (popstate); if neither ever
// resolves — a navigation that errors, a target we can't string-match — the
// overlay must still come down rather than trap the page behind it forever.
const MAX_COVER_MS = 7000
// Matches the source's 2050ms-from-click total (1400 + 650).
const REVEAL_HOLD_MS = 650
const READY_POLL_MS = 80

type Phase = 'cover' | 'reveal' | null

export function NavTransitionProvider() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [phase, setPhase] = useState<Phase>(null)
  const [pct, setPct] = useState(0)
  const [targetLabel, setTargetLabel] = useState('')

  // Refs, not state — these drive timers/handlers and must never trigger a
  // re-render on their own. Critically, pathnameRef/searchParamsRef exist so
  // tryReveal always reads the CURRENT route: the click/popstate listeners
  // below are attached once (empty deps, so listeners aren't torn down and
  // re-attached on every render) and close over whichever render's
  // beginTransition/tryReveal was current at attach time — reading
  // usePathname()/useSearchParams() directly from that closure would read
  // whatever the route was at mount, not after subsequent navigations.
  // Refs sidestep that entirely: whichever closure calls tryReveal, it reads
  // the live value.
  const phaseRef = useRef<Phase>(null)
  const pathnameRef = useRef(pathname)
  const searchParamsRef = useRef(searchParams)
  const pendingTarget = useRef<{ pathname: string; search: string } | null>(null)
  // Flipped true once the destination is confirmed reachable — by useTransition
  // settling (clicks), by an exact URL match (popstate / belt-and-suspenders),
  // or by the MAX_COVER_MS ceiling. tryReveal waits on this, not on a raw URL
  // comparison, so redirects and query-string targets no longer hang the overlay.
  const navSettledRef = useRef(false)
  // Tracks whether we've observed isPending go true for the current click nav,
  // so the effect below reveals only on the true→false edge — not on the
  // steady-state false that exists before any navigation begins.
  const sawPendingRef = useRef(false)
  const coverStartedAt = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const tickInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    pathnameRef.current = pathname
    searchParamsRef.current = searchParams
  }, [pathname, searchParams])

  function clearTimers() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (tickInterval.current) clearInterval(tickInterval.current)
    tickInterval.current = null
  }

  useEffect(() => () => clearTimers(), [])

  function tryReveal() {
    if (!pendingTarget.current) return
    const elapsed = Date.now() - coverStartedAt.current
    // Any one of three signals means the destination is here: useTransition
    // settled (clicks — survives redirects), the ceiling fired, or the live
    // route now exactly matches the target (popstate, and clicks where the
    // effect races the phase render).
    const settled =
      navSettledRef.current ||
      isNavigationSettled(
        { pathname: pathnameRef.current, search: searchParamsRef.current.toString() },
        pendingTarget.current,
      )
    if (elapsed < MIN_COVER_MS || !settled) {
      timers.current.push(setTimeout(tryReveal, READY_POLL_MS))
      return
    }
    pendingTarget.current = null
    navSettledRef.current = false
    sawPendingRef.current = false
    setPhase('reveal')
    timers.current.push(setTimeout(() => setPhase(null), REVEAL_HOLD_MS))
  }

  function beginTransition(label: string, targetPathname: string, targetSearch: string) {
    clearTimers()
    pendingTarget.current = { pathname: targetPathname, search: targetSearch }
    navSettledRef.current = false
    sawPendingRef.current = false
    coverStartedAt.current = Date.now()
    setTargetLabel(label)
    setPct(0)
    setPhase('cover')

    tickInterval.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - coverStartedAt.current) / 1150)
      setPct(Math.floor(p * 100))
      if (p >= 1 && tickInterval.current) {
        clearInterval(tickInterval.current)
        tickInterval.current = null
      }
    }, 40)

    timers.current.push(setTimeout(tryReveal, MIN_COVER_MS))
    timers.current.push(
      setTimeout(() => {
        navSettledRef.current = true
        tryReveal()
      }, MAX_COVER_MS),
    )
  }

  // Whenever the route settles, re-check immediately rather than waiting for
  // the next 80ms poll tick — tryReveal does the actual match against the
  // live refs. This is the readiness path for popstate (no useTransition).
  useEffect(() => {
    if (phaseRef.current === 'cover' && pendingTarget.current) tryReveal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  // The primary readiness path for click navigations: useTransition stays
  // pending until the destination's server components have committed —
  // through redirects, slow data, and query-string targets that an exact URL
  // match would never catch. Reveal on the true→false edge only.
  useEffect(() => {
    if (isPending) {
      sawPendingRef.current = true
    } else if (sawPendingRef.current && pendingTarget.current) {
      navSettledRef.current = true
      tryReveal()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (phaseRef.current) return // ignore clicks mid-transition — matches the source exactly
      const a = (e.target as HTMLElement | null)?.closest?.('a')
      if (!a) return

      const info: LinkClickInfo = {
        href: a.href,
        target: a.getAttribute('target'),
        download: a.hasAttribute('download'),
        ariaDisabled: a.getAttribute('aria-disabled') === 'true',
        modifierOrAuxClick: e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0,
      }
      if (!isInterceptableLinkClick(info, location.origin)) return
      e.preventDefault()

      const toURL = new URL(a.href, location.href)
      const target = toURL.pathname + toURL.search + toURL.hash
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const play = shouldPlayTransition(location.href, toURL.href, reducedMotion)

      if (!play) {
        router.push(target)
        return
      }

      const label = (a.textContent || '').trim() || a.getAttribute('aria-label') || 'LOADING'
      beginTransition(label, toURL.pathname, toURL.search)
      startTransition(() => router.push(target))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onPopState() {
      if (phaseRef.current) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      // The browser has already updated window.location by the time
      // popstate fires, and Next's own router handles re-rendering the
      // segment on its own — we only need to show the overlay in sync with
      // that, not trigger navigation ourselves. No clicked element exists
      // here to read a label from.
      beginTransition('LOADING', location.pathname, location.search)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!phase) return null
  return <NavTransitionOverlay phase={phase} pct={pct} targetLabel={targetLabel} />
}
