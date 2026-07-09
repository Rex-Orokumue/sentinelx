'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { recomputeAllScoring } from './apply'

export type RecomputeState = { error?: string; players?: number } | undefined

// useFormState passes (prevState, formData); this action takes no input from either.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function recomputeAllAction(_prev: RecomputeState, _formData: FormData): Promise<RecomputeState> {
  await requireAdmin()
  try {
    const admin = createAdminClient()
    const { players } = await recomputeAllScoring(admin)
    revalidatePath('/rankings')
    revalidatePath('/hall-of-fame')
    return { players }
  } catch {
    return { error: 'Recompute failed. Please try again.' }
  }
}
