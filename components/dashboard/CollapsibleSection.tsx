'use client'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export function CollapsibleSection({
  id,
  title,
  defaultOpen,
  summary,
  children,
}: {
  id?: string
  title: string
  defaultOpen: boolean
  summary?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section id={id} className="mb-10 scroll-mt-20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-4 flex w-full items-center justify-between gap-2 text-left"
      >
        <h2 className="text-base font-bold text-white">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {!open && summary && <span className="text-xs text-slate-500">{summary}</span>}
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {open && children}
    </section>
  )
}
