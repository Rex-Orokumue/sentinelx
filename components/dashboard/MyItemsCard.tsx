'use client'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { equipStoreItem } from '@/lib/coins/actions'
import { STORE_CATEGORY_LABELS } from '@/components/store/StoreGrid'
import type { OwnedItem } from '@/lib/dashboard/owned-items'

// No seeded store item currently sets preview_url (supabase/migrations/052_sx_coins_store.sql),
// so this fallback is the default render today, not a rare edge case — kept intentionally
// lightweight (no ImagePlaceholder — that component is sized for a full-width card image,
// not a 40px list-row icon) with a category emoji standing in until real art exists.
const CATEGORY_EMOJI: Record<string, string> = {
  avatar_border: '🖼️',
  profile_theme: '🎨',
  username_colour: '🔤',
  bubble_skin: '💬',
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-sx-border px-3 py-1.5 text-xs font-bold text-white hover:border-sx-purple/40 disabled:opacity-50"
    >
      {pending ? '…' : 'Equip'}
    </button>
  )
}

function EquipButton({ itemId }: { itemId: string }) {
  const [state, action] = useFormState(equipStoreItem, undefined)
  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="itemId" value={itemId} />
      <SubmitButton />
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
                <div
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sx-border bg-sx-surface/60 text-lg"
                >
                  {CATEGORY_EMOJI[item.category] ?? '🎁'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{item.name}</p>
                <p className="text-[11px] text-sx-gray">{STORE_CATEGORY_LABELS[item.category] ?? item.category}</p>
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
