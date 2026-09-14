import { describe, it, expect } from 'vitest'
import { isLocalId, newLocalId, buildReplyPreview, buildOptimisticMessage, mergeLocalMessages } from './optimistic'
import type { ConversationMessage } from './query'

function msg(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'm1',
    senderId: 'them',
    body: 'hi',
    imageUrl: null,
    stickerId: null,
    audioUrl: null,
    audioDurationSeconds: null,
    forwarded: false,
    createdAt: '2026-09-14T00:00:00Z',
    readAt: null,
    editedAt: null,
    deletedAt: null,
    replyTo: null,
    ...overrides,
  }
}

describe('newLocalId / isLocalId', () => {
  it('generates ids isLocalId recognises', () => {
    expect(isLocalId(newLocalId())).toBe(true)
  })
  it('does not treat a real uuid as local', () => {
    expect(isLocalId('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
  })
})

describe('buildReplyPreview', () => {
  it('labels the target "You" when the viewer sent it', () => {
    expect(buildReplyPreview(msg({ senderId: 'me' }), 'me', 'Other Player', 'hi')).toEqual({
      id: 'm1',
      senderName: 'You',
      body: 'hi',
      removed: false,
    })
  })
  it('labels the target by the other player\'s name otherwise', () => {
    expect(buildReplyPreview(msg({ senderId: 'them' }), 'me', 'Other Player', 'hi')).toEqual({
      id: 'm1',
      senderName: 'Other Player',
      body: 'hi',
      removed: false,
    })
  })
})

describe('buildOptimisticMessage', () => {
  it('defaults unset content fields to null and marks itself pending', () => {
    const out = buildOptimisticMessage({ id: 'local:1', viewerId: 'me', body: 'hello' })
    expect(out.senderId).toBe('me')
    expect(out.body).toBe('hello')
    expect(out.imageUrl).toBeNull()
    expect(out.stickerId).toBeNull()
    expect(out.audioUrl).toBeNull()
    expect(out.audioDurationSeconds).toBeNull()
    expect(out.forwarded).toBe(false)
    expect(out.readAt).toBeNull()
    expect(out.deletedAt).toBeNull()
    expect(out.replyTo).toBeNull()
    expect(out.status).toBe('pending')
  })

  it('carries through whichever content fields are given', () => {
    const out = buildOptimisticMessage({ id: 'local:2', viewerId: 'me', stickerId: 'gg' })
    expect(out.stickerId).toBe('gg')
    expect(out.body).toBeNull()
  })
})

describe('mergeLocalMessages', () => {
  it('appends pending and failed locals after the server list', () => {
    const server = [msg({ id: 's1' })]
    const previous = [msg({ id: 's1' }), buildOptimisticMessage({ id: 'local:1', viewerId: 'me', body: 'pending one' })]
    const merged = mergeLocalMessages(server, previous)
    expect(merged.map((m) => m.id)).toEqual(['s1', 'local:1'])
  })

  it('drops a local entry once its status is sent', () => {
    const previous = [{ ...buildOptimisticMessage({ id: 'local:1', viewerId: 'me', body: 'x' }), status: 'sent' as const }]
    expect(mergeLocalMessages([], previous)).toEqual([])
  })

  it('keeps a failed local entry across a refresh', () => {
    const previous = [{ ...buildOptimisticMessage({ id: 'local:1', viewerId: 'me', body: 'x' }), status: 'failed' as const }]
    const merged = mergeLocalMessages([], previous)
    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('failed')
  })
})
