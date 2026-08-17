import type { ReactNode } from 'react'

// Prose typography for the six pure-legal/rules pages plus /escrow and
// /tournament-guide (both prose-shaped in the spec). `prose-invert` matches
// the site's always-dark theme (app/layout.tsx renders <html class="dark">
// with no light variant). Colors mapped onto the sx-* design tokens instead
// of the plugin's defaults so it doesn't clash with the rest of the site.
export const proseClassName =
  'prose prose-invert prose-sm sm:prose-base max-w-none ' +
  'prose-headings:font-display prose-headings:font-bold prose-headings:text-white ' +
  'prose-h2:mt-10 prose-h2:text-xl prose-h3:mt-6 prose-h3:text-base ' +
  'prose-p:text-sx-gray prose-li:text-sx-gray prose-strong:text-white ' +
  'prose-a:text-sx-purple-text prose-a:no-underline hover:prose-a:underline'

export function StaticPageShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <header className="mb-8 border-b border-sx-border pb-6">
        {eyebrow && (
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl font-black uppercase leading-tight text-white sm:text-4xl">
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-sm text-sx-gray">{subtitle}</p>}
      </header>
      {children}
    </div>
  )
}
