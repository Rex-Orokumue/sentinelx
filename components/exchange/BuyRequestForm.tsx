'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBuyRequest } from '@/lib/exchange/requests-actions'
import { LISTING_CATEGORIES, CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'

export function BuyRequestForm({ games }: { games: { id: string; name: string }[] }) {
  const router = useRouter()
  const [category, setCategory] = useState<ListingCategory>('account')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await createBuyRequest({
        title: String(fd.get('title') ?? ''),
        category,
        gameId: String(fd.get('gameId') ?? '') || undefined,
        budget: Number(fd.get('budget') ?? 0),
        description: String(fd.get('description') ?? '') || undefined,
      })
      if (res.error) setError(res.error)
      else if (res.id) router.push('/dashboard')
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Title" name="title" required placeholder="e.g. FC Mobile account, high rated" />
      <div className="space-y-1.5">
        <label htmlFor="category" className="text-xs font-medium text-slate-400">Category</label>
        <select
          id="category"
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ListingCategory)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          {LISTING_CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="gameId" className="text-xs font-medium text-slate-400">Game (optional)</label>
        <select id="gameId" name="gameId" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none">
          <option value="">— None —</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>
      <Field label="Budget (₦)" name="budget" type="number" min={100} required />
      <div className="space-y-1.5">
        <label htmlFor="description" className="text-xs font-medium text-slate-400">Description</label>
        <textarea id="description" name="description" rows={4} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {pending ? 'Submitting…' : 'Submit request'}
      </button>
      <p className="text-[11px] text-slate-500">
        This is sent privately to a SentinelX admin, who&apos;ll reach out on WhatsApp if there&apos;s a match. It&apos;s never shown publicly.
      </p>
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
  min,
  placeholder,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  min?: number
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-xs font-medium text-slate-400">{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        min={min}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
