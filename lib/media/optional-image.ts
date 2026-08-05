import fs from 'fs'
import path from 'path'

const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

/**
 * Looks for /public/<dir>/<name>.<ext> across the known extensions and
 * returns its public URL path if found, else null. Lets a page render the
 * real mockup image the moment someone drops the file into `public/` — no
 * code change needed, no path to get wrong. Server-only (reads the
 * filesystem), so only call this from Server Components.
 */
export function findOptionalPublicImage(dir: string, name: string): string | null {
  for (const ext of EXTENSIONS) {
    const rel = `${dir}/${name}.${ext}`
    const abs = path.join(process.cwd(), 'public', rel)
    if (fs.existsSync(abs)) return `/${rel}`
  }
  return null
}
