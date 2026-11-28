// The sign-up screens once read "Signing up as ." because the message used a plain
// {placeholder} while the component passed a function for it.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import pcm from '@/messages/pcm.json'

describe.each([
  ['en', en],
  ['fr', fr],
  ['pcm', pcm],
] as const)('sign-up messages (%s)', (locale, messages) => {
  const t = createTranslator({ locale, messages, namespace: 'auth.signup' })
  const highlight = (chunks: unknown) => createElement('b', null, chunks as string)

  it.each([
    ['signingUpAs', 'username', 'name', 'ada_99'],
    ['checkEmailBody', 'email', 'address', 'ada@example.test'],
  ] as const)('%s shows the %s', (key, value, tag, typed) => {
    const out = t.rich(key, { [value]: typed, [tag]: highlight } as never)
    expect(renderToStaticMarkup(createElement('p', null, out))).toContain(`<b>${typed}</b>`)
  })
})
