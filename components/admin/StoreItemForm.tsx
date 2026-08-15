'use client'
import { useFormState } from 'react-dom'
import {
  createStoreItem,
  updateStoreItem,
  toggleStoreItemActive,
  type StoreActionState,
} from '@/lib/admin/store-actions'

export interface AdminStoreItem {
  id: string
  slug: string
  name: string
  category: string
  price_coins: number
  active: boolean
  sort_order: number
}

const STORE_CATEGORIES = ['avatar_border', 'profile_theme', 'username_colour', 'bubble_skin'] as const

const inputClass =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none'

type StoreItemFormProps = { mode: 'create' } | { mode: 'edit'; item: AdminStoreItem }

// mode="create" renders a standalone form block; mode="edit" renders a single
// <tr> (the page places it directly inside a <tbody>). Never render "create"
// inside table markup or "edit" outside it.
export function StoreItemForm(props: StoreItemFormProps) {
  if (props.mode === 'create') return <CreateStoreItemForm />
  return <EditStoreItemRow item={props.item} />
}

function CreateStoreItemForm() {
  const [state, action] = useFormState<StoreActionState, FormData>(createStoreItem, undefined)
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-bold text-white">Add store item</h3>
      <div className="grid grid-cols-2 gap-3">
        <input name="slug" placeholder="slug_like_this" required className={inputClass} />
        <input name="name" placeholder="Display name" required className={inputClass} />
        <select name="category" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Category…
          </option>
          {STORE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          name="priceCoins"
          type="number"
          min={1}
          placeholder="Price (SX Coins)"
          required
          className={inputClass}
        />
        <input name="previewUrl" placeholder="Preview URL (optional)" className={inputClass} />
        <input name="description" placeholder="Description (optional)" className={inputClass} />
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Item created.</p>}
      <button
        type="submit"
        className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
      >
        Add item
      </button>
    </form>
  )
}

// Two independent forms live side by side in this row's cells — an
// updateStoreItem form (price) and a toggleStoreItemActive form (active
// flag). They must stay SIBLING <form> elements, each in its own <td>; a
// <form> nested inside another <form> is invalid HTML and has bitten this
// codebase before.
function EditStoreItemRow({ item }: { item: AdminStoreItem }) {
  const [updateState, updateAction] = useFormState<StoreActionState, FormData>(updateStoreItem, undefined)
  const [toggleState, toggleAction] = useFormState<StoreActionState, FormData>(toggleStoreItemActive, undefined)

  return (
    <tr className="border-t border-slate-800">
      <td className="py-2 pr-3">
        <p className="font-semibold text-white">{item.name}</p>
        <p className="text-xs text-slate-500">{item.slug}</p>
      </td>
      <td className="pr-3 text-xs text-slate-400">{item.category}</td>
      <td className="pr-3">
        <form action={updateAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={item.id} />
          <input
            name="priceCoins"
            type="number"
            min={1}
            defaultValue={item.price_coins}
            required
            className={`${inputClass} w-24`}
          />
          <button
            type="submit"
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Save
          </button>
        </form>
        {updateState?.error && <p className="mt-1 text-xs text-red-400">{updateState.error}</p>}
      </td>
      <td className="pr-3">
        <form action={toggleAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="active" value={String(item.active)} />
          <button
            type="submit"
            className={`rounded-lg px-2 py-1 text-xs font-bold ${
              item.active ? 'bg-emerald-600/20 text-emerald-400' : 'bg-slate-700/40 text-slate-400'
            }`}
          >
            {item.active ? 'Active' : 'Inactive'}
          </button>
        </form>
        {toggleState?.error && <p className="mt-1 text-xs text-red-400">{toggleState.error}</p>}
      </td>
      <td></td>
    </tr>
  )
}
