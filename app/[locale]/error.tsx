'use client'
import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { logClientError } from '@/lib/errors/actions'

// Next.js's default fallback for an uncaught client exception ("Application
// error: a client-side exception has occurred") used to be a dead end — no
// logging anywhere, so a crash on someone's phone was invisible to us with
// no console to check. This boundary reports it (best-effort, fire-and-
// forget — logClientError never throws) and gives the visitor a way back in
// instead of a stuck page. Scoped to the [locale] tree, which is effectively
// the whole site; app/global-error.tsx is the backstop for anything above
// this (e.g. a crash in the root layout itself).
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ locale?: string }>()

  useEffect(() => {
    void logClientError({
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      url: window.location.href,
      userAgent: navigator.userAgent,
      locale: params?.locale,
    })
  }, [error, params?.locale])

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
      <p className="mt-3 text-sm text-sx-gray">
        That's on us, not your connection — the page hit an unexpected error. Try again, or head back home if it
        keeps happening.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light"
        >
          Try again
        </button>
        <a href="/" className="rounded-lg border border-sx-gray/30 px-5 py-2.5 text-sm font-bold text-white">
          Go home
        </a>
      </div>
    </div>
  )
}
