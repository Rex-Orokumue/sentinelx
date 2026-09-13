'use client'
import { useEffect, useRef, useState } from 'react'
import { X, Pause, Play, Check, Trash2, SendHorizonal } from 'lucide-react'
import { VoiceNoteBubble } from './VoiceNoteBubble'

// Auto-stops at 2:00 — same cost-bounding reasoning as the image composer's
// resize-to-1280px cap: keeps storage/bandwidth bounded without meaningfully
// limiting a DM voice note. Hitting the cap moves to review rather than
// sending outright, so there's still a chance to discard.
export const MAX_DURATION_SECONDS = 120

type Phase = 'recording' | 'paused' | 'reviewing'

// Tap-to-start/tap-to-stop, with a real pause (MediaRecorder.pause/resume —
// one continuous recording, not two clips glued together) and a listen-
// before-you-send review step. MessageComposer mounts this on mic-tap and
// unmounts it once onSend/onCancel fires; it owns nothing past that point —
// MessageComposer still does the actual upload+send.
export function VoiceNoteRecorder({
  onSend,
  onCancel,
}: {
  onSend: (blob: Blob, durationSeconds: number) => void
  onCancel: () => void
}) {
  const [phase, setPhase] = useState<Phase>('recording')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [reviewBlob, setReviewBlob] = useState<{ blob: Blob; url: string; duration: number } | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const totalSecondsRef = useRef(0) // seconds banked from segments already paused
  const segmentStartRef = useRef(0) // Date.now() when the current active segment started
  const isPausedRef = useRef(false) // mirrors `phase` for the onstop closure, which is set once at mount and would otherwise see a stale phase

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const recorder = new MediaRecorder(stream)
        recorderRef.current = recorder
        chunksRef.current = []
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        recorder.onstop = () => {
          // If we're stopping from a paused state, the active segment's time
          // was already banked by pause() — adding it again here would count
          // the paused wait itself as recorded duration.
          const liveSegment = isPausedRef.current ? 0 : (Date.now() - segmentStartRef.current) / 1000
          const total = totalSecondsRef.current + liveSegment
          const duration = Math.min(Math.max(1, Math.round(total)), MAX_DURATION_SECONDS)
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          stream.getTracks().forEach((t) => t.stop())
          setReviewBlob({ blob, url: URL.createObjectURL(blob), duration })
          setPhase('reviewing')
        }
        segmentStartRef.current = Date.now()
        recorder.start()
      } catch {
        if (!cancelled) setError('Microphone access denied.')
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The visible timer only ticks while actually recording — paused time
  // isn't counted, and it stops entirely once review starts.
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  // Side-effecting on the state VALUE, not inside setSeconds's updater
  // itself — a setState updater must stay pure (React 18 strict mode
  // double-invokes updaters in dev, which would double-fire the auto-stop).
  useEffect(() => {
    if (seconds >= MAX_DURATION_SECONDS) finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds])

  useEffect(() => {
    return () => {
      if (reviewBlob) URL.revokeObjectURL(reviewBlob.url)
    }
  }, [reviewBlob])

  function pause() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    recorder.pause()
    totalSecondsRef.current += (Date.now() - segmentStartRef.current) / 1000
    isPausedRef.current = true
    setPhase('paused')
  }

  function resume() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'paused') return
    recorder.resume()
    segmentStartRef.current = Date.now()
    isPausedRef.current = false
    setPhase('recording')
  }

  // Stops recording and moves to review — nothing is sent yet.
  function finish() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
  }

  function discard() {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null // suppress the review transition
      recorder.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (reviewBlob) URL.revokeObjectURL(reviewBlob.url)
    onCancel()
  }

  function send() {
    if (!reviewBlob) return
    onSend(reviewBlob.blob, reviewBlob.duration)
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
        <span>{error}</span>
        <button type="button" onClick={onCancel} aria-label="Close" className="shrink-0 text-white/70 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  if (phase === 'reviewing' && reviewBlob) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={discard}
          aria-label="Discard recording"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sx-gray hover:text-red-400"
        >
          <Trash2 className="h-5 w-5" />
        </button>
        <div className="flex-1 overflow-hidden rounded-lg border border-sx-border bg-sx-surface">
          <VoiceNoteBubble src={reviewBlob.url} durationSeconds={reviewBlob.duration} mine />
        </div>
        <button
          type="button"
          onClick={send}
          aria-label="Send voice note"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sx-purple text-white hover:bg-sx-purple-light"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={discard}
        aria-label="Cancel recording"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sx-gray hover:text-white"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="flex flex-1 items-center gap-2 rounded-lg border border-red-900/40 bg-sx-bg px-3 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full bg-red-500 ${phase === 'recording' ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-semibold text-white">{phase === 'recording' ? 'Recording…' : 'Paused'}</span>
        <span className="ml-auto text-xs tabular-nums text-sx-gray">
          {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, '0')}
        </span>
      </div>
      <button
        type="button"
        onClick={phase === 'recording' ? pause : resume}
        aria-label={phase === 'recording' ? 'Pause recording' : 'Resume recording'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sx-gray hover:text-white"
      >
        {phase === 'recording' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
      </button>
      <button
        type="button"
        onClick={finish}
        aria-label="Done — review before sending"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sx-purple text-white hover:bg-sx-purple-light"
      >
        <Check className="h-4 w-4" />
      </button>
    </div>
  )
}
