// Built-in sticker pack — no Store/coin economy, no art asset pipeline.
// Each sticker is a plain emoji rendered oversized with no bubble (see
// MessageBubble), sent as its own standalone message the moment it's
// tapped. `id` is what's stored in dm_messages.sticker_id and validated
// server-side against this whitelist (isValidStickerId) — swapping in
// illustrated art later means changing STICKER_PACK's rendering, not the
// storage shape or the validation.
export interface Sticker {
  id: string
  emoji: string
  label: string
}

export const STICKER_PACK: Sticker[] = [
  { id: 'gg', emoji: '🎮', label: 'GG' },
  { id: 'fire', emoji: '🔥', label: 'Fire' },
  { id: 'trophy', emoji: '🏆', label: 'Trophy' },
  { id: 'rage', emoji: '😤', label: 'Rage' },
  { id: 'ez', emoji: '😎', label: 'EZ' },
  { id: 'clutch', emoji: '💪', label: 'Clutch' },
  { id: 'lol', emoji: '😂', label: 'LOL' },
  { id: 'ggwp', emoji: '🤝', label: 'GGWP' },
  { id: 'sad', emoji: '😭', label: 'Sad' },
  { id: 'clap', emoji: '👏', label: 'Clap' },
  { id: 'rocket', emoji: '🚀', label: 'Rocket' },
  { id: 'skull', emoji: '💀', label: 'Skull' },
  { id: 'eyes', emoji: '👀', label: 'Eyes' },
  { id: 'goat', emoji: '🐐', label: 'GOAT' },
]

const STICKER_IDS = new Set(STICKER_PACK.map((s) => s.id))

export function isValidStickerId(id: string): boolean {
  return STICKER_IDS.has(id)
}

export function stickerById(id: string): Sticker | undefined {
  return STICKER_PACK.find((s) => s.id === id)
}
