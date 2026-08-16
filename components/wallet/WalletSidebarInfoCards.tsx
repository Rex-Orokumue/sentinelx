// The two static info cards below the wallet nav in the reference mockup
// (public/visual_bible/wallet_page.jpeg) — Zolarux Escrow reassurance +
// a support contact. Static content, no data dependency.
export function WalletSidebarInfoCards() {
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-2xl border border-sx-purple/30 bg-sx-surface p-4">
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-sx-purple-text">
          <span aria-hidden>🛡</span> Zolarux Escrow
        </p>
        <p className="mt-2 text-xs leading-relaxed text-sx-gray">
          All wallet transactions are protected by Zolarux Escrow. 100% Safe. 100% Trusted.
        </p>
        <a
          href="/coming-soon?feature=Zolarux+Escrow"
          className="mt-2 inline-block text-xs font-bold text-sx-purple-text hover:text-sx-purple-light"
        >
          Learn More →
        </a>
      </div>
      <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-sx-white">
          <span aria-hidden>🎧</span> Need Help?
        </p>
        <p className="mt-2 text-xs leading-relaxed text-sx-gray">Our support team is available 24/7.</p>
        <a
          href="/coming-soon?feature=Contact+Support"
          className="mt-2 inline-block text-xs font-bold text-sx-purple-text hover:text-sx-purple-light"
        >
          Contact Support →
        </a>
      </div>
    </div>
  )
}
