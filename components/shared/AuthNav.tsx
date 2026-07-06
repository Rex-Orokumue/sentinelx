import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/lib/auth/actions'

export async function AuthNav() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        Log in
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/dashboard"
        className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        Dashboard
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-lg px-3 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
