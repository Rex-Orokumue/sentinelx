'use client'

// Downscales/crops an image file to a size×size square WebP blob, matching
// the spec's "compress to 400×400px square WebP before upload" (§4.1).
export async function compressImageToWebp(file: File, size = 400, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
      'image/webp',
      quality,
    )
  })
}
