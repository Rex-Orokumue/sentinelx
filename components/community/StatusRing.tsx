'use client'
import { Plus } from 'lucide-react'
import { Avatar } from '@/components/shared/Avatar'
import { cn } from '@/lib/utils'

export interface StatusRingProps {
  name: string
  username: string | null
  avatarUrl: string | null
  unseen: boolean
  self?: boolean
  /** self && no statuses yet — show a dashed ring + plus badge instead of a live ring. */
  empty?: boolean
  label?: string
  onClick: () => void
}

export function StatusRing({ name, username, avatarUrl, unseen, empty, label, onClick }: StatusRingProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[72px] shrink-0 flex-col items-center gap-1"
      aria-label={label ?? `${name}'s status`}
    >
      <span
        className={cn(
          'relative rounded-full p-[2px]',
          empty
            ? 'border-2 border-dashed border-sx-border'
            : unseen
              ? 'bg-gradient-to-tr from-sx-purple to-fuchsia-500'
              : 'bg-sx-border',
        )}
      >
        <span className="block rounded-full border-2 border-sx-bg">
          <Avatar avatarUrl={avatarUrl} displayName={name} username={username} size={56} />
        </span>
        {empty && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-sx-purple text-white ring-2 ring-sx-bg">
            <Plus className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="max-w-[68px] truncate text-[11px] font-semibold text-sx-gray">{label ?? name}</span>
    </button>
  )
}
