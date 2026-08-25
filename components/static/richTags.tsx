import type { ReactNode } from 'react'

// Shared next-intl `t.rich()` tag renderers for the static/legal pages
// (terms, privacy, rules, safety, escrow, tournament-guide, ...). Message
// strings embed literal tags like `<strong>...</strong>` or
// `<email>...</email>`; spread the matching helper(s) below into the
// `t.rich('key', { ...tag })` call so every page renders them the same way
// instead of redefining renderers per file.
//
// Usage:
//   t.rich('s3P2', emailTag())
//   t.rich('s5List', listItemTag)   // wrap the call site in <ul>/<ol>

export const strongTag = {
  strong: (chunks: ReactNode) => <strong>{chunks}</strong>,
}

export const listItemTag = {
  li: (chunks: ReactNode) => <li>{chunks}</li>,
}

export function emailTag(address = 'sentinelxesports@gmail.com') {
  return {
    email: (chunks: ReactNode) => <a href={`mailto:${address}`}>{chunks}</a>,
  }
}

export function whatsappTag(href = 'https://wa.me/2349032395685') {
  return {
    whatsapp: (chunks: ReactNode) => <a href={href}>{chunks}</a>,
  }
}

export function linkTag(href: string, opts: { external?: boolean } = {}) {
  return {
    link: (chunks: ReactNode) =>
      opts.external ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {chunks}
        </a>
      ) : (
        <a href={href}>{chunks}</a>
      ),
  }
}
