'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { tvVideoSchema } from './schema'

export type TvVideoState = { error?: string; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return tvVideoSchema.safeParse({
    title: formData.get('title') ?? '',
    category: formData.get('category') ?? '',
    youtubeUrl: formData.get('youtubeUrl') ?? '',
    description: formData.get('description') ?? '',
    thumbnailUrl: formData.get('thumbnailUrl') ?? '',
  })
}
function revalidate() {
  revalidatePath('/tv')
  revalidatePath('/admin/tv')
}

export async function addVideo(_prev: TvVideoState, formData: FormData): Promise<TvVideoState> {
  const ctx = await requireStaff()
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const supabase = createClient()
  const { error } = await supabase.from('tv_videos').insert({
    title: d.title,
    category: d.category,
    youtube_url: d.youtubeUrl,
    description: d.description || null,
    thumbnail_url: d.thumbnailUrl || null,
    created_by: ctx.userId,
  })
  if (error) return { error: 'Could not save the video. Please try again.' }
  revalidate()
  return { success: true }
}

export async function updateVideo(_prev: TvVideoState, formData: FormData): Promise<TvVideoState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing video.' }
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const supabase = createClient()
  const { error } = await supabase
    .from('tv_videos')
    .update({
      title: d.title,
      category: d.category,
      youtube_url: d.youtubeUrl,
      description: d.description || null,
      thumbnail_url: d.thumbnailUrl || null,
    })
    .eq('id', id)
  if (error) return { error: 'Could not update the video.' }
  revalidate()
  return { success: true }
}

export async function toggleVideoActive(_prev: TvVideoState, formData: FormData): Promise<TvVideoState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const currentlyActive = String(formData.get('active') ?? '') === 'true'
  if (!id) return { error: 'Missing video.' }
  const supabase = createClient()
  const { error } = await supabase.from('tv_videos').update({ active: !currentlyActive }).eq('id', id)
  if (error) return { error: 'Could not update visibility.' }
  revalidate()
  return { success: true }
}

export async function deleteVideo(_prev: TvVideoState, formData: FormData): Promise<TvVideoState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing video.' }
  const supabase = createClient()
  const { error } = await supabase.from('tv_videos').delete().eq('id', id)
  if (error) return { error: 'Could not delete the video.' }
  revalidate()
  return { success: true }
}
