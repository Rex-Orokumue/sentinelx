import Link from 'next/link'
import Image from 'next/image'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <Image src="/logo-icon.png" alt="SentinelX Esports" width={40} height={40} />
          <span className="flex flex-col items-center leading-none">
            <span className="font-display text-2xl font-bold uppercase tracking-tight">
              Sentinel<span className="text-violet-400">X</span>
            </span>
            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">
              Esports
            </span>
          </span>
        </Link>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          {children}
        </div>
      </div>
    </div>
  )
}
