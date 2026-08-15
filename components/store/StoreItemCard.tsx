'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { purchaseStoreItem, equipStoreItem } from '@/lib/coins/actions'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'

export interface StoreItem {
  id: string
  slug: string
  name: string
  description: string | null
  category: string
  price_coins: number
  preview_url: string | null
}

function SubmitButton({ children, variant }: { children: React.ReactNode; variant: 'buy' | 'equip' }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={`w-full rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
        variant === 'buy' ? 'bg-sx-purple text-white hover:bg-sx-purple-light' : 'border border-sx-border text-white hover:border-sx-purple/40'
      }`}
    >
      {pending ? '…' : children}
    </button>
  )
}

export function StoreItemCard({
  item,
  owned,
  equipped,
  isLoggedIn,
}: {
  item: StoreItem
  owned: boolean
  equipped: boolean
  isLoggedIn: boolean
}) {
  const [purchaseState, purchaseAction] = useFormState(purchaseStoreItem, undefined)
  const [equipState, equipAction] = useFormState(equipStoreItem, undefined)

  return (
    <div className="flex flex-col rounded-xl border border-sx-border bg-sx-surface p-3">
      {item.preview_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.preview_url} alt={item.name} className="mb-2 aspect-square w-full rounded-lg object-cover" />
      ) : (
        <ImagePlaceholder className="mb-2 aspect-square w-full rounded-lg" label={item.name} />
      )}
      <p className="truncate text-xs font-bold text-white">{item.name}</p>
      <p className="mb-2 text-[11px] text-sx-gray">🪙 {item.price_coins.toLocaleString()}</p>
      {!isLoggedIn ? (
        <a href="/login?next=/store" className="block rounded-lg border border-sx-border px-3 py-2 text-center text-xs font-bold text-white">
          Sign in
        </a>
      ) : equipped ? (
        <span className="block rounded-lg bg-sx-green/20 px-3 py-2 text-center text-xs font-bold text-sx-green">Equipped</span>
      ) : owned ? (
        <form action={equipAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <SubmitButton variant="equip">Equip</SubmitButton>
        </form>
      ) : (
        <form action={purchaseAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <SubmitButton variant="buy">Buy</SubmitButton>
        </form>
      )}
      {purchaseState?.error && <p className="mt-1 text-[10px] text-red-400">{purchaseState.error}</p>}
      {equipState?.error && <p className="mt-1 text-[10px] text-red-400">{equipState.error}</p>}
    </div>
  )
}
