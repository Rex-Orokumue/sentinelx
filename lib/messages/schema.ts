import { z } from 'zod'

// Mirrors dm_messages CHECKs: btrim(body) <> '' and char_length(body) <= 2000.
export const messageBodySchema = z
  .string()
  .trim()
  .min(1, 'Type a message first')
  .max(2000, 'Keep it under 2000 characters')

// Mirrors dm_messages_audio_duration_positive plus the recorder's own 2-minute
// cap (VoiceNoteRecorder.MAX_DURATION_SECONDS) — a little headroom above 120
// covers a recording that finished uploading a beat after the auto-stop fired.
export const audioDurationSchema = z.number().int().positive().max(130)

// Mirrors dm_reports.reason CHECK (1..1000).
export const reportReasonSchema = z
  .string()
  .trim()
  .min(1, 'Add a reason so staff can act on it')
  .max(1000, 'Keep it under 1000 characters')
