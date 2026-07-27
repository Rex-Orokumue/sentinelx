import Link from 'next/link'
import { GuideBubble } from '@/components/home/GuideBubble'

export function Hero({ isLoggedIn, whatsappUrl }: { isLoggedIn: boolean; whatsappUrl: string }) {
  return (
    <section className="relative mb-10 overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-b from-violet-950/40 to-slate-950 px-6 py-12 sm:px-10">
      <div className="grid items-center justify-items-center gap-8 lg:grid-cols-[1fr_auto_auto] lg:justify-items-start">
        <div className="text-center lg:text-left">
          <h1 className="font-display text-4xl font-black uppercase leading-tight text-white sm:text-5xl">
            Welcome to <span className="text-violet-400">Sentinel X</span> Esports
          </h1>
          <p className="mt-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Compete. <span className="text-violet-400">Conquer.</span> Become a Legend.
          </p>
          <p className="mx-auto mt-4 max-w-md text-sm text-slate-400 lg:mx-0">
            Join tournaments, connect with gamers, climb the leaderboards and represent Sentinel X
            Esports.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/signup"
              className="w-full max-w-xs rounded-xl bg-violet-600 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 sm:w-auto"
            >
              Register Now
            </Link>
            <Link
              href="/tournaments"
              className="w-full max-w-xs rounded-xl border border-slate-700 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:border-slate-500 sm:w-auto"
            >
              Explore
            </Link>
          </div>
        </div>

        <div
          aria-hidden
          className="flex h-56 w-44 shrink-0 items-center justify-center rounded-2xl border border-dashed border-violet-500/30 bg-slate-900/50 text-center text-xs text-slate-600 sm:h-72 sm:w-56"
        >
          Mascot artwork
        </div>

        {!isLoggedIn && <GuideBubble whatsappUrl={whatsappUrl} />}
      </div>
    </section>
  )
}
