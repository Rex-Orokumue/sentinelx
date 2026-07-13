'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import type { AdminNotificationItem } from '@/lib/admin/notification-copy'

export function AdminNotificationBell({ items }: { items: AdminNotificationItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  function onSelect(item: AdminNotificationItem) {
    setOpen(false)
    router.push(item.link)
  }

  const visible = items.slice(0, 20)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Admin notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-800"
      >
        <Bell className="h-5 w-5" />
        {items.length > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 max-h-96 w-80 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 py-1 shadow-xl">
          {visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing needs attention.</p>
          ) : (
            visible.map((item, i) => (
              <button
                key={`${item.type}-${item.createdAt}-${i}`}
                type="button"
                onClick={() => onSelect(item)}
                className="block w-full px-4 py-3 text-left text-sm transition-colors hover:bg-slate-800"
              >
                <p className="font-semibold text-white">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-400">{item.body}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
