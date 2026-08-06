'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { recomputeAllScoring } from './apply'

export type RecomputeState = { error?: string; players?: number } | undefined

export async function recomputeAllAction(_prev: RecomputeState, _formData: FormData): Promise<RecomputeState> {
  // requireAdmin() calls redirect() on failure — that throws a special
  // Next.js error that must not be caught; let it propagate naturally.
  await requireAdmin()
  try {
    const admin = createAdminClient()
    const { players } = await recomputeAllScoring(admin)
    revalidatePath('/rankings')
    revalidatePath('/hall-of-fame')
    revalidatePath('/admin')
    return { players }
  } catch (err) {
    // Don't swallow NEXT_REDIRECT — rethrow so Next.js can handle navigation.
    if (
      err != null &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw err
    }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[recomputeAllAction]', msg)
    return { error: `Recompute failed: ${msg}` }
  }
}
