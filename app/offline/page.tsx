// No data fetching here by design — this page is served from the service
// worker's cache when there is no network at all, so anything beyond
// static markup would just fail. It still renders inside the root layout
// (SiteHeader/SiteFooter), which does its own Supabase session check —
// that's an accepted characteristic of caching full SSR'd pages, not
// something this page can control on its own.
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-bold text-white">You&apos;re offline</h1>
      <p className="mt-3 text-sm text-sx-gray">
        This page needs a connection to load. Static pages like this one still work — everything else (tournaments,
        matches, your dashboard) needs you back online.
      </p>
      <a
        href="/"
        className="mt-6 rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        Try again
      </a>
    </div>
  )
}
