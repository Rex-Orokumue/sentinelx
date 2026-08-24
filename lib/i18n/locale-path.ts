import { LOCALES, DEFAULT_LOCALE, type Locale } from '@/i18n/locales'

export function splitLocaleFromPathname(pathname: string): { locale: Locale; pathname: string } {
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue
    const prefix = `/${locale}`
    if (pathname === prefix) return { locale, pathname: '/' }
    if (pathname.startsWith(`${prefix}/`)) return { locale, pathname: pathname.slice(prefix.length) }
  }
  return { locale: DEFAULT_LOCALE, pathname }
}

export function withLocalePrefix(pathname: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return pathname
  return pathname === '/' ? `/${locale}` : `/${locale}${pathname}`
}
