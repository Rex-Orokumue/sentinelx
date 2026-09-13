'use client'
import { useEffect, useRef, useState } from 'react'
import { X, Square } from 'lucide-react'

// Auto-stops at 2:00 — same cost-bounding reasoning as the image composer's
// resize-to-1280px cap: keeps storage/bandwidth bounded without meaningfully
// limiting a DM voice note.
export const MAX_DURATION_SECONDS = 120

// Tap-to-start/tap-to-stop (this component only exists while "started" —
// MessageComposer mounts it on mic-tap and unmounts it once onRecorded/
// onCancel fires). Records via MediaRecorder into memory; the caller
// (MessageComposer) owns uploading the resulting blob and sending the
// message, mirroring how it already owns the image upload step.
export function VoiceNoteRecorder({
  onRecorded,
  onCancel,
}: {
  onRecorded: (blob: Blob, durationSeconds: number) => void
  onCancel: () => void
}) {
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
          const elapsed = Math.min(Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)), MAX_DURATION_SECONDS)
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          stream.getTracks().forEach((t) => t.stop())
          onRecorded(blob, elapsed)
        }
        startedAtRef.current = Date.now()
        recorder.start()
        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
      } catch {
        if (!cancelled) setError('Microphone access denied.')
      }
    }
    start()
    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Side-effecting on a state VALUE, not inside the setSeconds updater
  // itself — a setState updater must stay pure (React 18 strict mode
  // double-invokes updaters in dev, which would double-fire the auto-stop).
  useEffect(() => {
    if (seconds >= MAX_DURATION_SECONDS) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds])

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
  }

  function cancel() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (recorderRef.current) {
      recorderRef.current.onstop = null // suppress onRecorded
      if (recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    onCancel()
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

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={cancel}
        aria-label="Cancel recording"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sx-gray hover:text-white"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="flex flex-1 items-center gap-2 rounded-lg border border-red-900/40 bg-sx-bg px-3 py-2">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
        <span className="text-xs font-semibold text-white">Recording…</span>
        <span className="ml-auto text-xs tabular-nums text-sx-gray">
          {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, '0')}
        </span>
      </div>
      <button
        type="button"
        onClick={stop}
        aria-label="Stop and send"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sx-purple text-white hover:bg-sx-purple-light"
      >
        <Square className="h-4 w-4" />
      </button>
    </div>
  )
}
