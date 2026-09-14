'use client'
import { useRef, useState } from 'react'
import { ImageLightbox } from './ImageLightbox'

// Scroll-snap + dots, no carousel library (spec: "Out — ... the cuttable
// corner: the carousel" is about NOT building this; the addendum decided to
// build it anyway). Every slide is letterboxed (object-contain in a fixed
// aspect box), never cropped — the class of bug that hit the game cards from
// a fixed-height object-cover crop.
export function PostMediaCarousel({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  if (images.length === 0) return null

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    setIndex(Math.min(images.length - 1, Math.max(0, i)))
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => {
              setIndex(i)
              setLightboxOpen(true)
            }}
            aria-label={`View image ${i + 1} of ${images.length}`}
            className="flex aspect-[4/3] w-full flex-none snap-center items-center justify-center bg-black"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-contain" />
          </button>
        ))}
      </div>

      {images.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-2">
          {images.map((_, i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-sx-purple' : 'bg-sx-gray/40'}`} />
          ))}
        </div>
      )}

      {lightboxOpen && (
        <ImageLightbox urls={images} index={index} onClose={() => setLightboxOpen(false)} onIndexChange={setIndex} />
      )}
    </>
  )
}
