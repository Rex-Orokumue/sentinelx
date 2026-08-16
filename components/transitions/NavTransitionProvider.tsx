'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { isInterceptableLinkClick, shouldPlayTransition, type LinkClickInfo } from '@/lib/nav/transition-guard'
import { NavTransitionOverlay } from './NavTransitionOverlay'

// Spec §3.2. The cover animation always runs at least this long even for an
// instantly-ready destination (so a fast page never feels rushed); if the
// destination isn't ready yet, this is a floor, not a ceiling — tryReveal
// keeps re-checking until it is.
const MIN_COVER_MS = 1400
// Matches the source's 2050ms-from-click total (1400 + 650).
const REVEAL_HOLD_MS = 650
const READY_POLL_MS = 80

type Phase = 'cover' | 'reveal' | null

export function NavTransitionProvider() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

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
    const ready =
      pathnameRef.current === pendingTarget.current.pathname &&
      searchParamsRef.current.toString() === pendingTarget.current.search
    if (elapsed < MIN_COVER_MS || !ready) {
      timers.current.push(setTimeout(tryReveal, READY_POLL_MS))
      return
    }
    pendingTarget.current = null
    setPhase('reveal')
    timers.current.push(setTimeout(() => setPhase(null), REVEAL_HOLD_MS))
  }

  function beginTransition(label: string, targetPathname: string, targetSearch: string) {
    clearTimers()
    pendingTarget.current = { pathname: targetPathname, search: targetSearch }
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
  }

  // Whenever the route actually settles, re-check immediately — without
  // this, a fast navigation that finishes mid-cover would sit idle until
  // the next 80ms poll tick instead of revealing the moment it's ready.
  useEffect(() => {
    if (phaseRef.current === 'cover' && pendingTarget.current) tryReveal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

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
