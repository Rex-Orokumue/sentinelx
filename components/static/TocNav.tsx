'use client'

import { useEffect, useState } from 'react'
import type { TocEntry } from '@/lib/static/toc'

type TocNavProps = {
  entries: TocEntry[]
  label: string
  variant: 'rail' | 'disclosure'
}

export function TocNav({ entries, label, variant }: TocNavProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const targets = entries
      .map((e) => document.getElementById(e.id))
      .filter((el): el is HTMLElement => el !== null)
    if (targets.length === 0) return

    const observer = new IntersectionObserver(
      (observed) => {
        const visible = observed
          .filter((o) => o.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      // top offset clears the sticky header; bottom bias so a section counts
      // as "active" only once it's well into view
      { rootMargin: '-80px 0px -70% 0px' },
    )
    targets.forEach((t) => observer.observe(t))
    return () => observer.disconnect()
  }, [entries])

  const list = (
    <ol className="space-y-1.5">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            className={`block border-l-2 py-0.5 pl-3 text-sm transition-colors ${
              activeId === entry.id
                ? 'border-sx-purple font-semibold text-white'
                : 'border-transparent text-sx-gray hover:text-white'
            }`}
          >
            {entry.title}
          </a>
        </li>
      ))}
    </ol>
  )

  if (variant === 'disclosure') {
    return (
      <details className="mb-8 rounded-xl border border-sx-border bg-sx-surface p-4 lg:hidden">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-sx-purple-text">
          {label}
        </summary>
        <nav aria-label={label} className="mt-3">
          {list}
        </nav>
      </details>
    )
  }

  return (
    <nav aria-label={label} className="hidden lg:block lg:sticky lg:top-24 lg:self-start">
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{label}</p>
      {list}
    </nav>
  )
}
