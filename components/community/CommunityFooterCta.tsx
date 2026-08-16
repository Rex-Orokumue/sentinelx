import Link from 'next/link'

export function CommunityFooterCta() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-sx-purple/30 bg-gradient-to-r from-sx-purple/20 via-sx-surface to-sx-purple/10 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
      <div>
        <p className="font-display text-lg font-black text-white">Be active. Be positive. Be legendary.</p>
        <p className="text-sm text-sx-gray">Your journey starts here. The community is waiting for you!</p>
      </div>
      <Link
        href="#new-post-launcher"
        className="shrink-0 rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        Join the Community
      </Link>
    </div>
  )
}
