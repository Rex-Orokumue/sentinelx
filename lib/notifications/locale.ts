import { createTranslator } from 'next-intl'
import { LOCALES, DEFAULT_LOCALE, type Locale } from '@/i18n/locales'

// Locale handling for notifications, which are the one place in the app that
// renders copy OUTSIDE a request: cron routes, and work deferred past the
// response (see defer.ts). There is no request locale to read, and there
// shouldn't be — a notification renders in the RECIPIENT's language, never the
// language of whoever triggered it. An English-speaking admin confirming a
// result for a `pcm` player sends that player Pidgin.

// `profiles.locale` is a free text column, so treat anything unrecognised as
// English. A notification must never fail to send over an unexpected value.
export function toLocale(value: string | null | undefined): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE
}

// Dynamic import rather than three static ones: the catalogs are ~60-70KB each
// and every server action that sends a notification would otherwise bundle all
// three. Node caches the module after the first call, so the cost is paid once
// per locale per instance.
async function catalog(locale: Locale): Promise<Record<string, unknown>> {
  const messages = await import(`../../messages/${locale}.json`)
  return messages.default
}

// The slice of next-intl's translator these renderers use. Declared here rather
// than inferred: createTranslator derives its key union from the shape of the
// messages object, and a catalog loaded at runtime has no literal shape, so the
// inferred key type collapses to `never`. Naming the signature keeps the
// renderers honest about what they may call without pretending we have
// compile-time key checking that a dynamic import cannot give us.
export type Translate = (key: string, values?: Record<string, string | number>) => string

// Returns next-intl's `t` bound to one locale and namespace. createTranslator,
// not getTranslations: the latter reads from request context and throws where
// these sends actually run.
export async function translatorFor(locale: Locale, namespace: string): Promise<Translate> {
  const t = createTranslator({ locale, messages: await catalog(locale), namespace })
  return t as unknown as Translate
}
