'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { addBanner, updateBanner, type BannerFormState } from '@/lib/banners/admin-actions'
import { createClient } from '@/lib/supabase/client'

export interface BannerDefaults {
  id?: string
  title?: string
  imageUrl?: string
  linkUrl?: string
}

export function BannerForm({ defaults, onDone }: { defaults?: BannerDefaults; onDone?: () => void }) {
  const editing = Boolean(defaults?.id)
  const action = editing ? updateBanner : addBanner
  const [state, formAction] = useFormState<BannerFormState, FormData>(action, undefined)
  const [imageUrl, setImageUrl] = useState(defaults?.imageUrl ?? '')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  if (state?.success && onDone) onDone()

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError(null)
    const supabase = createClient()
    const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
    const path = `${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('banner-images').upload(path, file, { upsert: false })
    if (error) {
      setUploadError('Image failed to upload. Please try again.')
      setUploading(false)
      return
    }
    const { data } = supabase.storage.from('banner-images').getPublicUrl(path)
    setImageUrl(data.publicUrl)
    setUploading(false)
  }

  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      {editing && <input type="hidden" name="id" value={defaults!.id} />}
      <div className="space-y-1.5">
        <label htmlFor="title" className="text-xs font-medium text-slate-400">
          Internal title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          defaultValue={defaults?.title}
          placeholder="e.g. DLS 26 Season 2 announcement"
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">Banner image</label>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="mb-2 max-h-40 rounded-lg border border-slate-700" />
        )}
        <input
          type="file"
          accept="image/*"
          onChange={onFile}
          disabled={uploading}
          className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-600 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white hover:file:bg-violet-500"
        />
        {uploading && <span className="text-xs text-slate-400">Uploading…</span>}
        {uploadError && <span className="text-xs text-red-400">{uploadError}</span>}
        <input type="hidden" name="imageUrl" value={imageUrl} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="linkUrl" className="text-xs font-medium text-slate-400">
          Link URL
        </label>
        <input
          id="linkUrl"
          name="linkUrl"
          type="text"
          defaultValue={defaults?.linkUrl}
          placeholder="/tournaments/… or https://…"
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!imageUrl || uploading}
          className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-40"
        >
          {editing ? 'Save changes' : 'Add banner'}
        </button>
        {state?.success && <span className="text-xs text-emerald-400">Saved.</span>}
        {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
      </div>
    </form>
  )
}
