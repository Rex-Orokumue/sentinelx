'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getChatHistory } from '@/lib/chat/actions'
import type { ChatMessage } from '@/lib/chat/sanitize-history'

const FALLBACK_MESSAGE = 'Having trouble responding right now — try again shortly.'

export function ChatTab({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(!isLoggedIn)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isLoggedIn || historyLoaded) return
    let cancelled = false
    getChatHistory().then((res) => {
      if (cancelled) return
      if (res.ok) setMessages(res.messages)
      setHistoryLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [isLoggedIn, historyLoaded])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setSending(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      })
      if (!res.ok || !res.body) {
        setMessages([...nextMessages, { role: 'assistant', content: FALLBACK_MESSAGE }])
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        assistantText += decoder.decode(value, { stream: true })
        setMessages([...nextMessages, { role: 'assistant', content: assistantText }])
      }
    } catch {
      setMessages([...nextMessages, { role: 'assistant', content: FALLBACK_MESSAGE }])
    } finally {
      setSending(false)
    }
  }

  async function handleClear() {
    setMessages([])
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('chat_messages').delete().eq('player_id', user.id)
  }

  return (
    <div className="flex h-full min-h-[280px] flex-col">
      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto pb-2">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-sx-gray">
            Ask me anything about tournaments, fees, SX Score, or {isLoggedIn ? 'your account' : 'how SentinelX works'}.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-sx-purple text-white' : 'border border-sx-border bg-sx-surface text-white'
              }`}
            >
              {m.content || (m.role === 'assistant' && sending ? '…' : '')}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-sx-border pt-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !sending) handleSend()
          }}
          placeholder="Type a message…"
          className="flex-1 rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-white placeholder:text-sx-gray focus:outline-none focus:ring-1 focus:ring-sx-purple"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="rounded-lg bg-sx-purple px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {isLoggedIn && messages.length > 0 && (
        <button type="button" onClick={handleClear} className="mt-2 self-start text-xs text-sx-gray hover:underline">
          Clear chat
        </button>
      )}
    </div>
  )
}
