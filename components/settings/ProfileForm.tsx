'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { updateProfile, type ProfileEditState } from '@/lib/profile/actions'
import { compressImageToWebp } from '@/lib/avatars/compress'
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface SettingsProfile {
  displayName: string | null
  username: string
  usernameChangedAt: string | null
  avatarUrl: string | null
  membershipTier: MembershipTier
  whatsapp: string | null
  country: string | null
  bio: string | null
}

export function ProfileForm({ profile }: { profile: SettingsProfile }) {
  const [state, formAction] = useFormState<ProfileEditState, FormData>(updateProfile, undefined)
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const usernameLocked = !!profile.usernameChangedAt
  const [usernameValue, setUsernameValue] = useState(profile.username)

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
    try {
      const compressed = await compressImageToWebp(file)
      const path = `${user.id}/${crypto.randomUUID()}.webp`
      const { error } = await supabase.storage.from('avatars').upload(path, compressed, {
        upsert: false,
        contentType: 'image/webp',
      })
      if (error) throw error
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
    } catch {
      setUploadError('Avatar upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-white">Profile</h2>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="avatarUrl" value={avatarUrl ?? ''} />
        <div className="flex items-center gap-4">
          <HexAvatar src={avatarUrl} username={profile.displayName ?? profile.username} tier={profile.membershipTier} size="lg" />
          <label className="cursor-pointer text-sm font-semibold text-sx-purple-text hover:text-sx-purple-light">
            {uploading ? 'Uploading…' : 'Upload new photo'}
            <input type="file" accept="image/*" onChange={onAvatarFile} className="hidden" disabled={uploading} />
          </label>
        </div>
        <p className="text-xs text-sx-gray">Supported: JPG, PNG · Compressed to 400×400</p>
        {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}

        <Field label="Display Name" name="displayName" defaultValue={profile.displayName ?? ''} required />

        <div className="space-y-1.5">
          <label htmlFor="username" className="text-sm font-medium text-sx-gray">Username</label>
          {usernameLocked ? (
            <p className="flex items-center gap-1.5 rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-sx-gray">
              🔒 @{profile.username} — Contact support to change username.
            </p>
          ) : (
            <>
              <input
                id="username"
                name="username"
                type="text"
                value={usernameValue}
                onChange={(e) => setUsernameValue(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sx-purple focus:outline-none"
              />
              <p className="text-xs text-amber-400">⚠ Username can only be changed once.</p>
            </>
          )}
        </div>

        <Field label="Bio" name="bio" defaultValue={profile.bio ?? ''} textarea maxLength={280} />
        <Field label="Country" name="country" defaultValue={profile.country ?? ''} />
        <Field label="WhatsApp" name="whatsapp" defaultValue={profile.whatsapp ?? ''} type="tel" placeholder="+2348012345678" />

        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        {state?.success && <p className="text-sm text-emerald-400">Profile updated.</p>}
        <button
          type="submit"
          disabled={uploading}
          className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light disabled:opacity-50"
        >
          Save Changes
        </button>
      </form>
    </section>
  )
}

function Field({
  label, name, defaultValue, required, textarea, maxLength, type = 'text', placeholder,
}: {
  label: string; name: string; defaultValue: string; required?: boolean
  textarea?: boolean; maxLength?: number; type?: string; placeholder?: string
}) {
  const cls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-sx-purple focus:outline-none'
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-sx-gray">{label}</label>
      {textarea ? (
        <textarea id={name} name={name} rows={3} maxLength={maxLength} defaultValue={defaultValue} className={cls} />
      ) : (
        <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} className={cls} />
      )}
    </div>
  )
}
