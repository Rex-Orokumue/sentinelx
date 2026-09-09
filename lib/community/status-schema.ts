import { z } from 'zod'

// Mirrors the DB CHECKs on player_statuses:
//   player_statuses_caption_len  -> caption IS NULL OR char_length(caption) <= 200
//   player_statuses_has_content  -> image_url IS NOT NULL OR btrim(caption) <> ''
// This is the friendly-message twin of those constraints, shared by the
// composer (client) and postStatus (server).

export const statusCaptionSchema = z
  .string()
  .trim()
  .max(200, 'Keep your caption under 200 characters')
  .transform((s) => (s.length === 0 ? null : s))

type StatusInput = { imageUrl?: string | null; caption?: string | null }
type StatusInputResult =
  | { ok: true; data: { imageUrl: string | null; caption: string | null } }
  | { ok: false; error: string }

export function validateStatusInput(input: StatusInput): StatusInputResult {
  const imageUrl =
    typeof input.imageUrl === 'string' && input.imageUrl.trim().length > 0
      ? input.imageUrl.trim()
      : null

  const parsedCaption = statusCaptionSchema.safeParse(input.caption ?? '')
  if (!parsedCaption.success) {
    return { ok: false, error: parsedCaption.error.issues[0].message }
  }
  const caption = parsedCaption.data

  if (!imageUrl && !caption) {
    return { ok: false, error: 'Add a photo or write something first.' }
  }
  return { ok: true, data: { imageUrl, caption } }
}
