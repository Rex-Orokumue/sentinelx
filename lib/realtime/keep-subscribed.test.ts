import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keepSubscribed } from './keep-subscribed'

// Behaves like Realtime where it matters: removing a channel reports CLOSED to
// that channel's own callback, synchronously.
function fakeRealtime() {
  const channels: { callback: (status: string) => void; removed: boolean }[] = []
  const client = {
    removeChannel: vi.fn((channel: (typeof channels)[number]) => {
      channel.removed = true
      channel.callback('CLOSED')
      return Promise.resolve('ok')
    }),
  }
  const create = vi.fn(() => {
    const channel = {
      callback: (_status: string) => {},
      removed: false,
      subscribe(callback: (status: never) => void) {
        channel.callback = callback as (status: string) => void
      },
    }
    channels.push(channel)
    return channel
  })
  const latest = () => channels[channels.length - 1]
  return { client, create, channels, latest }
}

// The fake implements only what keepSubscribed touches.
const keep = (options: Record<string, unknown>) => keepSubscribed(options as unknown as Parameters<typeof keepSubscribed>[0])

const delays = [10, 20, 30]
const settle = () => vi.advanceTimersByTimeAsync(1000)

describe('keepSubscribed', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('removes a failed channel once instead of recursing', () => {
    const rt = fakeRealtime()
    keep({ client: rt.client, create: rt.create, delays })
    expect(() => rt.latest().callback('CHANNEL_ERROR')).not.toThrow()
    expect(rt.client.removeChannel).toHaveBeenCalledTimes(1)
  })

  it('stops after the last retry when the channel keeps failing', async () => {
    const rt = fakeRealtime()
    keep({ client: rt.client, create: rt.create, delays })
    for (let i = 0; i < 20; i++) {
      if (!rt.latest().removed) rt.latest().callback('CHANNEL_ERROR')
      await settle()
    }
    expect(rt.create).toHaveBeenCalledTimes(1 + delays.length)
    expect(rt.channels.every((c) => c.removed)).toBe(true)
  })

  it('gets a full set of retries again after a successful subscribe', async () => {
    const rt = fakeRealtime()
    const onSubscribed = vi.fn()
    keep({ client: rt.client, create: rt.create, onSubscribed, delays: [10] })
    for (let i = 0; i < 3; i++) {
      rt.latest().callback('CLOSED')
      await settle()
      rt.latest().callback('SUBSCRIBED')
    }
    expect(rt.create).toHaveBeenCalledTimes(4)
    expect(onSubscribed).toHaveBeenCalledTimes(3)
  })

  it('restart() opens one new channel, even after giving up or when called twice', async () => {
    const rt = fakeRealtime()
    const connection = keep({ client: rt.client, create: rt.create, delays: [] })
    rt.latest().callback('TIMED_OUT')
    await settle()
    expect(rt.create).toHaveBeenCalledTimes(1)
    connection.restart()
    connection.restart()
    await settle()
    expect(rt.create).toHaveBeenCalledTimes(2)
  })

  it('stop() removes the channel and cancels any pending retry', async () => {
    const rt = fakeRealtime()
    const connection = keep({ client: rt.client, create: rt.create, delays })
    rt.latest().callback('CHANNEL_ERROR')
    connection.stop()
    await settle()
    expect(rt.create).toHaveBeenCalledTimes(1)
  })
})
