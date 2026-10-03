import { describe, it, expect } from 'vitest'
import { parseProfileEditFormData } from './form-data'
import { profileEditSchema } from './schema'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function baseForm() {
  const fd = new FormData()
  fd.set('displayName', 'Ada')
  fd.set('username', '')
  fd.set('whatsapp', '08012345678')
  fd.set('country', 'Nigeria')
  fd.set('bio', 'hi')
  return fd
}

describe('parseProfileEditFormData', () => {
  it('reads every field including repeated gameInterests entries and the consent hidden input', () => {
    const fd = baseForm()
    fd.set('consentWhatsappUpdates', 'true')
    fd.append('gameInterests', A)
    fd.append('gameInterests', B)

    expect(parseProfileEditFormData(fd)).toEqual({
      displayName: 'Ada',
      username: '',
      whatsapp: '08012345678',
      country: 'Nigeria',
      bio: 'hi',
      consentWhatsappUpdates: true,
      gameInterests: [A, B],
    })
  })

  it('omits consentWhatsappUpdates and gameInterests entirely when the form sends neither key (leave-unchanged path)', () => {
    const result = parseProfileEditFormData(baseForm())
    expect(result).toEqual({ displayName: 'Ada', username: '', whatsapp: '08012345678', country: 'Nigeria', bio: 'hi' })
    expect(result).not.toHaveProperty('consentWhatsappUpdates')
    expect(result).not.toHaveProperty('gameInterests')
  })

  it('reads consentWhatsappUpdates as false when the hidden input is present but "false"', () => {
    const fd = baseForm()
    fd.set('consentWhatsappUpdates', 'false')
    expect(parseProfileEditFormData(fd)).toMatchObject({ consentWhatsappUpdates: false })
  })

  it('ignores a consent value that is neither "true" nor "false" instead of guessing', () => {
    const fd = baseForm()
    fd.set('consentWhatsappUpdates', 'maybe')
    expect(parseProfileEditFormData(fd)).not.toHaveProperty('consentWhatsappUpdates')
  })

  it('feeds profileEditSchema without losing the new fields, and an old form still validates', () => {
    const full = baseForm()
    full.set('consentWhatsappUpdates', 'false')
    full.append('gameInterests', A)
    const parsedFull = profileEditSchema.parse(parseProfileEditFormData(full))
    expect(parsedFull.consentWhatsappUpdates).toBe(false)
    expect(parsedFull.gameInterests).toEqual([A])

    const parsedOld = profileEditSchema.parse(parseProfileEditFormData(baseForm()))
    expect(parsedOld.consentWhatsappUpdates).toBeUndefined()
    expect(parsedOld.gameInterests).toBeUndefined()
  })
})
