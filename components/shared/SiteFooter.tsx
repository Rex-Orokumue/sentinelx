import Link from 'next/link'
import { FOOTER_SECTIONS } from '@/lib/nav/links'

// The only nav surface rendered at every breakpoint. The desktop header hides
// below `sm` and the mobile bottom bar only holds the four pillars, so this is
// what makes every destination reachable on both — /tv on desktop, and
// /rankings, /games, /about, /players, /hall-of-fame on mobile.
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-slate-800">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.heading}>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {section.heading}
              </h2>
              <ul className="space-y-1.5">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-slate-400 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-8 border-t border-slate-800/80 pt-5 text-center text-xs text-slate-600">
          © {new Date().getFullYear()} SentinelX Esports · Nigeria&apos;s Home of Mobile Esports
        </p>
      </div>
    </footer>
  )
}
