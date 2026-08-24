export const LOCALES = ['en', 'fr', 'pcm'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
