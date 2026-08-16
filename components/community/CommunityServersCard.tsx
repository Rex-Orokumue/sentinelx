const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_URL ?? '#'
const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL ?? '#'

// Live per-platform member counts from the mockup (5,610 / 3,214 / 2,145)
// are dropped — no honest source for them (spec §4.6). Discord reuses the
// same env var as SiteFooter; WhatsApp reuses the whatsappUrl already
// threaded through the header/page; Telegram is a new env var following the
// same `?? '#'` fallback pattern as the other social links.
export function CommunityServersCard({ whatsappUrl }: { whatsappUrl: string }) {
  const servers = [
    { name: 'Discord Server', href: DISCORD_URL, icon: '🎮' },
    { name: 'WhatsApp Community', href: whatsappUrl, icon: '💬' },
    { name: 'Telegram Channel', href: TELEGRAM_URL, icon: '✈️' },
  ]
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Our Official Community Servers</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {servers.map((s) => (
          <div key={s.name} className="flex items-center justify-between rounded-xl border border-sx-border bg-sx-bg p-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="text-lg" aria-hidden>
                {s.icon}
              </span>
              {s.name}
            </span>
            <a
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-lg bg-sx-purple px-3 py-1.5 text-xs font-bold text-white hover:bg-sx-purple-light"
            >
              Join
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
