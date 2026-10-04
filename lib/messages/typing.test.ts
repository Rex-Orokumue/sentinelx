import { describe, it, expect, vi } from 'vitest'
import { createTypingSender, createTypingTracker, typingTopic, TYPING_SEND_INTERVAL_MS, TYPING_EXPIRE_MS } from './typing'

describe('typingTopic', () => {
  it('names the per-thread topic the database policy authorises', () => {
    expect(typingTopic('0b0d1b9e-1111-4222-8333-444455556666')).toBe('dm-typing:0b0d1b9e-1111-4222-8333-444455556666')
  })
})

describe('createTypingSender', () => {
  it('sends at most once per interval while keys keep coming', () => {
    let t = 0
    const send = vi.fn()
    const s = createTypingSender(() => t, send)
    s.notifyKeystroke()
    t = 1000
    s.notifyKeystroke()
    t = TYPING_SEND_INTERVAL_MS - 1
    s.notifyKeystroke()
    expect(send).toHaveBeenCalledTimes(1)
    t = TYPING_SEND_INTERVAL_MS
    s.notifyKeystroke()
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('sends on the very first keystroke even at time zero', () => {
    const send = vi.fn()
    createTypingSender(() => 0, send).notifyKeystroke()
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('createTypingTracker', () => {
  it('shows typing until the expiry after the last event, then stops', () => {
    let t = 0
    const tr = createTypingTracker(() => t)
    expect(tr.isTyping('u2')).toBe(false)
    tr.onEvent('u2')
    t = TYPING_EXPIRE_MS - 1
    expect(tr.isTyping('u2')).toBe(true)
    t = TYPING_EXPIRE_MS + 1
    expect(tr.isTyping('u2')).toBe(false)
  })
  it('a fresh event extends the window', () => {
    let t = 0
    const tr = createTypingTracker(() => t)
    tr.onEvent('u2')
    t = 4000
    tr.onEvent('u2')
    t = 8000
    expect(tr.isTyping('u2')).toBe(true)
  })
  it('tracks users independently', () => {
    const tr = createTypingTracker(() => 0)
    tr.onEvent('u2')
    expect(tr.isTyping('u3')).toBe(false)
  })
})
