export function HeroSection() {
  return (
    <div
      className="relative flex h-[280px] w-full items-center overflow-hidden sm:h-[360px]"
      style={{
        background:
          'radial-gradient(ellipse at 20% 50%, rgba(124,58,237,0.35) 0%, transparent 60%),' +
          'radial-gradient(ellipse at 80% 50%, rgba(245,158,11,0.2) 0%, transparent 60%),#0B0B0F',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 animate-float text-[180px] opacity-30 sm:block"
      >
        🏆
      </div>
      <div className="relative mx-auto max-w-3xl px-4 text-center sm:text-left">
        <h1 className="font-display text-5xl font-black uppercase text-white sm:text-8xl">Hall of Fame</h1>
        <p className="mt-2 font-display text-lg italic text-sx-gray sm:text-xl">Where Legends Are Made</p>
        <p className="mt-2 text-sm text-sx-gray">Nigeria&apos;s greatest mobile esports achievers.</p>
      </div>
    </div>
  )
}
