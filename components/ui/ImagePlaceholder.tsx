import { ImageOff } from 'lucide-react'

// A visibly-a-placeholder box for a mockup image we don't have the real asset
// for yet — reserves the exact layout slot without inventing a substitute
// design. `label` should say exactly what image belongs here so whoever drops
// the file in later knows what to grab.
export function ImagePlaceholder({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sx-border bg-sx-surface/60 p-6 text-center ${className}`}
    >
      <ImageOff className="h-6 w-6 shrink-0 text-sx-gray" />
      <p className="text-xs font-semibold leading-snug text-sx-gray">{label}</p>
    </div>
  )
}
