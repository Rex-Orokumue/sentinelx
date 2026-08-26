'use client'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { equipStoreItem } from '@/lib/coins/actions'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'
import type { OwnedItem } from '@/lib/dashboard/owned-items'

const CATEGORY_LABEL: Record<string, string> = {
  avatar_border: 'Avatar Border',
  profile_theme: 'Profile Theme',
  username_colour: 'Username Colour',
  bubble_skin: 'Mascot Skin',
}

function EquipButton({ itemId }: { itemId: string }) {
  const [state, action] = useFormState(equipStoreItem, undefined)
  const { pending } = useFormStatus()
  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="itemId" value={itemId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-sx-border px-3 py-1.5 text-xs font-bold text-white hover:border-sx-purple/40 disabled:opacity-50"
      >
        {pending ? '…' : 'Equip'}
      </button>
      {state?.error && <p className="mt-1 text-[10px] text-red-400">{state.error}</p>}
    </form>
  )
}

export function MyItemsCard({ items }: { items: OwnedItem[] }) {
  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white">🎒 My Items</h2>
        <Link href="/store" className="text-xs font-bold text-sx-purple-text hover:text-white">
          Visit Store →
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-sx-gray">No items yet — spend your coins in the store to customize your profile.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-xl border border-sx-border bg-sx-bg p-3">
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URLs aren't in next.config's image domains
                <img src={item.previewUrl} alt={item.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <ImagePlaceholder className="h-10 w-10 shrink-0 rounded-lg" label={item.name} />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{item.name}</p>
                <p className="text-[11px] text-sx-gray">{CATEGORY_LABEL[item.category] ?? item.category}</p>
              </div>
              {item.equipped ? (
                <span className="shrink-0 rounded-lg bg-sx-green/20 px-3 py-1.5 text-xs font-bold text-sx-green">Equipped</span>
              ) : (
                <EquipButton itemId={item.id} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
