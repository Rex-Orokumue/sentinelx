'use client'
import { useEffect } from 'react'
import { logClientError } from '@/lib/errors/actions'

// Backstop for a crash above app/[locale]/error.tsx's reach — the root
// layout itself, or the [locale] error boundary throwing in turn. Next.js
// requires global-error to render its own <html>/<body> since it replaces
// the whole tree, which also means it can't lean on anything from the
// normal layout (globals.css, providers) that might itself be implicated —
// deliberately plain inline styles, no Tailwind classes, nothing else to
// break.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    void logClientError({
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    })
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          backgroundColor: '#0b0713',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Something went wrong</h1>
        <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#9c93a8', maxWidth: '28rem' }}>
          The page hit an unexpected error. Reloading usually fixes it.
        </p>
        <a
          href="/"
          style={{
            marginTop: '1.5rem',
            borderRadius: '0.5rem',
            backgroundColor: '#7c3aed',
            padding: '0.625rem 1.25rem',
            fontSize: '0.875rem',
            fontWeight: 700,
            color: '#fff',
            textDecoration: 'none',
          }}
        >
          Go home
        </a>
      </body>
    </html>
  )
}
