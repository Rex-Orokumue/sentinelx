import { DashboardShell } from '@/components/dashboard/DashboardShell'

export function SettingsLoadError() {
  return (
    <DashboardShell>
      <h1 className="mb-4 text-lg font-bold text-white">Settings</h1>
      <div role="alert" className="rounded-2xl border border-red-900/50 bg-red-950/10 p-5">
        <p className="font-bold text-red-400">We couldn&apos;t load your settings</p>
        <p className="mt-1 text-sm text-slate-300">
          Your account is unchanged. Check your connection and try again.
        </p>
        {/* A full page load on purpose: it asks the server again. */}
        <a
          href="/dashboard/settings"
          className="mt-4 inline-block rounded-xl bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light"
        >
          Try again
        </a>
      </div>
    </DashboardShell>
  )
}
