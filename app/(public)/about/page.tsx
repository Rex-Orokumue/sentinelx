import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

export const metadata = buildMetadata({
  title: 'About Us · SentinelX Esports',
  description: "Sentinel X Esports is building Nigeria's home of mobile esports — our mission and story.",
  path: '/about',
  image: DEFAULT_OG_IMAGE,
})

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-10 text-center">
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-violet-400">About Us</p>
      <h1 className="mb-6 text-2xl font-black text-white">Nigeria&apos;s Home of Mobile Esports</h1>
      <p className="mb-4 text-sm text-slate-400">
        Sentinel X Esports exists to build the most trusted and exciting mobile esports platform in
        Africa — a place where gamers compete, connect, and transact safely.
      </p>
      <p className="mb-4 text-sm text-slate-400">
        We started with Dream League Soccer because that&apos;s where Nigeria&apos;s mobile gaming
        community already was — but Sentinel X was built from day one to grow into every game our
        players care about, not stay a one-game platform.
      </p>
      <p className="text-sm text-slate-400">
        Behind Sentinel X is a small team of Nigerian gamers and builders who believe competitive mobile
        gaming deserves real tournaments, real prizes, and a real community — not just screenshots in a
        WhatsApp group.
      </p>
    </div>
  )
}
