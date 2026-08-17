'use client'
import { useEffect, useRef, useState } from 'react'
import { computeCountUpValue } from './count-up'

const DEFAULT_DURATION_MS = 1400

/**
 * Animates `target` counting up from 0 once its host element scrolls into
 * view. Skips straight to `target` when the user has `prefers-reduced-motion`
 * set, and only ever plays once per mount (re-triggering on every scroll back
 * into view would be distracting, not "gamey"). No test file — this is thin
 * browser-API wiring (IntersectionObserver + requestAnimationFrame) around
 * the tested `computeCountUpValue`; this codebase doesn't unit-test DOM
 * wiring (see Global Constraints).
 */
export function useCountUp<T extends HTMLElement>(target: number, durationMs = DEFAULT_DURATION_MS) {
  const ref = useRef<T>(null)
  const [value, setValue] = useState(0)
  const played = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (played.current || !entries[0]?.isIntersecting) return
        played.current = true
        observer.disconnect()

        const start = performance.now()
        function tick(now: number) {
          const elapsed = now - start
          setValue(computeCountUpValue(elapsed, durationMs, target))
          if (elapsed < durationMs) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      },
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [target, durationMs])

  return { ref, value }
}
