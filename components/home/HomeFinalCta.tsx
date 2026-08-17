import Link from 'next/link'

export function HomeFinalCta() {
  return (
    <section className="relative mb-10 overflow-hidden rounded-2xl border border-sx-border bg-sx-surface px-6 py-14 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(124,58,237,0.13) 0%, transparent 70%)' }}
      />
      <div className="relative">
        <h2 className="mb-3 font-display text-5xl font-black uppercase leading-[0.95] text-white sm:text-6xl">
          Ready to Compete?
        </h2>
        <p className="mb-8 text-sm text-sx-gray sm:text-base">
          Join hundreds of Nigerian mobile gamers already competing on SentinelX.
          <br />
          Registration is free. First tournament entry from ₦500.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 rounded-lg bg-sx-purple px-9 py-3.5 font-display text-base font-black uppercase tracking-wide text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-all hover:-translate-y-0.5 hover:bg-sx-purple-light"
        >
          Create Your Account →
        </Link>
        <p className="mt-4 text-xs text-sx-gray">
          Already registered?{' '}
          <Link href="/login" className="text-sx-purple-text hover:text-white">
            Sign In
          </Link>
        </p>
      </div>
    </section>
  )
}
