import { describe, it, expect } from 'vitest'
import { extensionForAudioMime } from './audio-extension'

describe('extensionForAudioMime', () => {
  it('maps webm (Chrome/Firefox default)', () => {
    expect(extensionForAudioMime('audio/webm;codecs=opus')).toBe('webm')
    expect(extensionForAudioMime('audio/webm')).toBe('webm')
  })

  it('maps mp4/aac (Safari default) to m4a', () => {
    expect(extensionForAudioMime('audio/mp4')).toBe('m4a')
    expect(extensionForAudioMime('audio/aac')).toBe('m4a')
  })

  it('maps ogg and wav', () => {
    expect(extensionForAudioMime('audio/ogg;codecs=opus')).toBe('ogg')
    expect(extensionForAudioMime('audio/wav')).toBe('wav')
  })

  it('falls back to webm for an unrecognised or empty type', () => {
    expect(extensionForAudioMime('')).toBe('webm')
    expect(extensionForAudioMime('audio/x-made-up')).toBe('webm')
  })
})
