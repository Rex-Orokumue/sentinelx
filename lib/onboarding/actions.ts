'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { usernameSchema } from '@/lib/auth/schema'
import { safeInternalPath } from './safe-path'

export type ClaimUsernameState = { error?: string } | undefined

export async function claimUsername(
  _prev: ClaimUsernameState,
  formData: FormData,
): Promise<ClaimUsernameState> {
  const parsed = usernameSchema.safeParse(formData.get('username'))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/username')

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', parsed.data)
    .maybeSingle()
  if (existing) return { error: 'That username is taken — try another.' }

  const { error } = await supabase
    .from('profiles')
    .update({ username: parsed.data, display_name: parsed.data })
    .eq('id', user.id)
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'That username is taken — try another.' }
    }
    return { error: 'Could not save your username. Please try again.' }
  }

  redirect(safeInternalPath(formData.get('next') as string | null, '/dashboard'))
}
