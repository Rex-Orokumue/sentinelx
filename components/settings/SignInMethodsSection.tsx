'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState } from 'react-dom'
import { useTranslations } from 'next-intl'
import { unlinkGoogle, type UnlinkState } from '@/lib/auth/identities'
import { createClient } from '@/lib/supabase/client'

export type SignInMethod = { provider: string; email: string | null }

export function SignInMethodsSection({
  methods,
  linkResult,
}: {
  methods: SignInMethod[]
  // 'google' after a successful link, 'error' when the callback bounced one
  // back — usually because that Google account is already on another account.
  linkResult: 'google' | 'error' | null
}) {
  const t = useTranslations('signInMethods')
  const google = methods.find((m) => m.provider === 'google')
  const email = methods.find((m) => m.provider === 'email')
  const isOnlyMethod = methods.length < 2

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">{t('title')}</h2>
      <p className="mt-1 text-xs leading-relaxed text-sx-gray">{t('intro')}</p>

      {linkResult === 'google' && (
        <p className="mt-3 text-xs text-emerald-400">{t('linkedOk')}</p>
      )}
      {linkResult === 'error' && <p className="mt-3 text-xs text-red-400">{t('linkFailed')}</p>}

      <div className="mt-3 space-y-3 border-t border-sx-border pt-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-white">{t('google')}</p>
            <p className="text-xs text-sx-gray">
              {google ? google.email ?? t('linked') : t('notLinked')}
            </p>
          </div>
          {google ? (
            <UnlinkGoogle isOnlyMethod={isOnlyMethod} />
          ) : (
            <LinkGoogleButton label={t('link')} />
          )}
        </div>

        <div className="border-t border-sx-border pt-3">
          <p className="font-semibold text-white">{t('emailPassword')}</p>
          <p className="text-xs text-sx-gray">{email ? email.email ?? t('linked') : t('notSet')}</p>
        </div>
      </div>
    </section>
  )
}

function LinkGoogleButton({ label }: { label: string }) {
  async function handleClick() {
    // linkIdentity has to run in the browser — it navigates to Google and comes
    // back through /auth/oauth/callback, which exchanges the PKCE code. The
    // intent marker is what sends a failure back to settings instead of /login.
    await createClient().auth.linkIdentity({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/oauth/callback?intent=link&next=${encodeURIComponent('/dashboard/settings?linked=google')}`,
      },
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="shrink-0 rounded-lg border border-sx-border px-3 py-1.5 text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light"
    >
      {label}
    </button>
  )
}

function UnlinkGoogle({ isOnlyMethod }: { isOnlyMethod: boolean }) {
  const t = useTranslations('signInMethods')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, formAction] = useFormState<UnlinkState, FormData>(async (prev, fd) => {
    const result = await unlinkGoogle(prev, fd)
    if (result?.unlinked) {
      setOpen(false)
      router.refresh()
    }
    return result
  }, undefined)

  // Nothing to offer: removing the only way in would lock the account.
  if (isOnlyMethod) {
    return <p className="max-w-[15rem] text-xs text-sx-gray">{t('onlyMethod')}</p>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg border border-red-900/50 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-950/30"
      >
        {t('unlink')}
      </button>
    )
  }

  return (
    <form action={formAction} className="w-full space-y-2 rounded-xl border border-sx-border bg-slate-950/40 p-3">
      <p className="text-xs leading-relaxed text-sx-gray">{t('unlinkExplain')}</p>
      <label className="block text-xs text-sx-gray" htmlFor="unlink-password">
        {t('passwordLabel')}
      </label>
      <input
        id="unlink-password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        className="w-full rounded-lg border border-sx-border bg-slate-950 px-3 py-2 text-sm text-white"
      />
      {state?.errorCode && <p className="text-xs text-red-400">{t(`errors.${state.errorCode}`)}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500"
        >
          {t('unlinkConfirm')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-sx-border px-4 py-2 text-sm text-sx-gray"
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  )
}
