'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { updateProfile, type ProfileEditState } from '@/lib/profile/actions'
import { Avatar } from '@/components/shared/Avatar'

export interface EditableProfile {
  displayName: string | null
  username: string | null
  avatarUrl: string | null
  whatsapp: string | null
  country: string | null
  bio: string | null
}

export function ProfileEditForm({ profile }: { profile: EditableProfile }) {
  const [state, formAction] = useFormState<ProfileEditState, FormData>(updateProfile, undefined)
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function onAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError(null)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      setUploadError('Please log in.')
      return
    }
    const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: false })
    if (error) {
      setUploading(false)
      setUploadError('Avatar upload failed. Please try again.')
      return
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    setAvatarUrl(data.publicUrl)
    setUploading(false)
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Edit profile</h2>
      <form action={formAction} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <input type="hidden" name="avatarUrl" value={avatarUrl ?? ''} />
        <div className="flex items-center gap-3">
          <Avatar avatarUrl={avatarUrl} displayName={profile.displayName} username={profile.username} size={56} />
          <label className="cursor-pointer text-sm font-semibold text-violet-400 hover:text-violet-300">
            {uploading ? 'Uploading…' : 'Change photo'}
            <input type="file" accept="image/*" onChange={onAvatarFile} className="hidden" disabled={uploading} />
          </label>
        </div>
        {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}

        <div className="space-y-1.5">
          <label htmlFor="displayName" className="text-sm font-medium text-slate-300">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            defaultValue={profile.displayName ?? ''}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="whatsapp" className="text-sm font-medium text-slate-300">
            WhatsApp number
          </label>
          <input
            id="whatsapp"
            name="whatsapp"
            type="tel"
            defaultValue={profile.whatsapp ?? ''}
            placeholder="+2348012345678"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="country" className="text-sm font-medium text-slate-300">
            Country
          </label>
          <input
            id="country"
            name="country"
            type="text"
            defaultValue={profile.country ?? ''}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="bio" className="text-sm font-medium text-slate-300">
            Bio
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            maxLength={280}
            defaultValue={profile.bio ?? ''}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          />
        </div>

        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        {state?.success && <p className="text-sm text-emerald-400">Profile updated.</p>}
        <button
          type="submit"
          disabled={uploading}
          className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Save changes
        </button>
      </form>
    </section>
  )
}
