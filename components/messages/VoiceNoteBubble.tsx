'use client'
import { useEffect, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Play/pause + a filling progress line + elapsed/total time — deliberately
// not a waveform (that needs Web Audio API amplitude analysis, a much
// bigger component for the same "it's a voice note" read). `durationSeconds`
// is the value stored at send time so the label has something to show
// before the browser finishes loading metadata; once it does, the real
// duration takes over.
export function VoiceNoteBubble({
  src,
  durationSeconds,
  mine,
}: {
  src: string
  durationSeconds: number | null
  mine: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(durationSeconds ?? 0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    function onTime() {
      setCurrentTime(audio!.currentTime)
    }
    function onLoaded() {
      if (Number.isFinite(audio!.duration)) setDuration(audio!.duration)
    }
    function onEnded() {
      setPlaying(false)
      setCurrentTime(0)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio.play()
      setPlaying(true)
    }
  }

  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${mine ? 'bg-white/20' : 'bg-white/10'}`}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
      </button>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
        <div className="h-full rounded-full bg-white/70" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="shrink-0 text-[10px] tabular-nums opacity-80">
        {formatDuration(currentTime > 0 ? currentTime : duration)}
      </span>
    </div>
  )
}
