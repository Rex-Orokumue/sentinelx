'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { bannerSchema } from './schema'

export type BannerFormState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return bannerSchema.safeParse({
    title: formData.get('title') ?? '',
    imageUrl: formData.get('imageUrl') ?? '',
    linkUrl: formData.get('linkUrl') ?? '',
  })
}
function revalidate() {
  revalidatePath('/')
  revalidatePath('/admin/banners')
}

export async function addBanner(_prev: BannerFormState, formData: FormData): Promise<BannerFormState> {
  const ctx = await requireStaff()
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const supabase = createClient()
  const { error } = await supabase.from('homepage_banners').insert({
    title: d.title,
    image_url: d.imageUrl,
    link_url: d.linkUrl,
    created_by: ctx.userId,
  })
  if (error) return { error: 'Could not save the banner. Please try again.' }
  revalidate()
  return { success: true }
}

export async function updateBanner(_prev: BannerFormState, formData: FormData): Promise<BannerFormState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing banner.' }
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const supabase = createClient()
  const { error } = await supabase
    .from('homepage_banners')
    .update({ title: d.title, image_url: d.imageUrl, link_url: d.linkUrl })
    .eq('id', id)
  if (error) return { error: 'Could not save changes.' }
  revalidate()
  return { success: true }
}

export async function toggleBannerActive(
  _prev: BannerFormState,
  formData: FormData,
): Promise<BannerFormState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const currentlyActive = String(formData.get('active') ?? '') === 'true'
  if (!id) return { error: 'Missing banner.' }
  const supabase = createClient()
  const { error } = await supabase
    .from('homepage_banners')
    .update({ active: !currentlyActive })
    .eq('id', id)
  if (error) return { error: 'Could not update visibility.' }
  revalidate()
  return { success: true }
}

export async function deleteBanner(_prev: BannerFormState, formData: FormData): Promise<BannerFormState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing banner.' }
  const supabase = createClient()
  const { error } = await supabase.from('homepage_banners').delete().eq('id', id)
  if (error) return { error: 'Could not delete the banner.' }
  revalidate()
  return { success: true }
}
