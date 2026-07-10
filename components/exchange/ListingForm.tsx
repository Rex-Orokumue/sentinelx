'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createListing } from '@/lib/exchange/actions'
import { LISTING_CATEGORIES, CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { imageRequired } from '@/lib/exchange/images'

interface Img {
  url: string
}

export function ListingForm({ games }: { games: { id: string; name: string }[] }) {
  const router = useRouter()
  const [category, setCategory] = useState<ListingCategory>('account')
  const [images, setImages] = useState<Img[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      setError('Please log in.')
      return
    }
    for (const file of files.slice(0, 8 - images.length)) {
      const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('listing-images').upload(path, file, { upsert: false })
      if (upErr) {
        setError('An image failed to upload. Please try again.')
        continue
      }
      const { data } = supabase.storage.from('listing-images').getPublicUrl(path)
      setImages((prev) => [...prev, { url: data.publicUrl }])
    }
    setUploading(false)
  }

  function move(from: number, to: number) {
    setImages((prev) => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it)
      return next
    })
  }
  function removeImg(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i))
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    if (imageRequired(category) && images.length === 0) {
      setError('This category needs at least one image.')
      return
    }
    startTransition(async () => {
      const res = await createListing({
        title: String(fd.get('title') ?? ''),
        category,
        price: Number(fd.get('price') ?? 0),
        gameId: String(fd.get('gameId') ?? '') || undefined,
        description: String(fd.get('description') ?? '') || undefined,
        imageUrls: images.map((i) => i.url),
      })
      if (res.error) setError(res.error)
      else if (res.id) router.push(`/exchange/${res.id}`)
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Title" name="title" required />
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
        {imageRequired(category) && <p className="text-[11px] text-amber-400">This category requires at least one image.</p>}
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
      <Field label="Price (₦)" name="price" type="number" required />
      <div className="space-y-1.5">
        <label htmlFor="description" className="text-xs font-medium text-slate-400">Description</label>
        <textarea id="description" name="description" rows={4} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
      </div>

      {/* Images: upload, reorder (drag on desktop, arrows anywhere), remove */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-400">Images (first is the cover)</label>
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div
              key={img.url}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); move(Number(e.dataTransfer.getData('text/plain')), i) }}
              className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 px-1 text-[10px] text-white">
                <button type="button" onClick={() => move(i, i - 1)} aria-label="Move left">◀</button>
                <button type="button" onClick={() => removeImg(i)} aria-label="Remove">✕</button>
                <button type="button" onClick={() => move(i, i + 1)} aria-label="Move right">▶</button>
              </div>
            </div>
          ))}
          {images.length < 8 && (
            <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-700 text-2xl text-slate-500 hover:border-slate-500">
              +
              <input type="file" accept="image/*" multiple onChange={onFiles} className="hidden" />
            </label>
          )}
        </div>
        {uploading && <p className="text-xs text-slate-400">Uploading…</p>}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending || uploading}
        className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {pending ? 'Publishing…' : 'Submit for review'}
      </button>
      <p className="text-[11px] text-slate-500">Listings are reviewed by an admin before going live.</p>
    </form>
  )
}

function Field({ label, name, type = 'text', required }: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-xs font-medium text-slate-400">{label}</label>
      <input id={name} name={name} type={type} required={required} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
    </div>
  )
}
