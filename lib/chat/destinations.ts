import { DESTINATIONS, type Destination } from './types'

const MAX_TOKEN = 40 // "{{go:notifications}}" is 20; anything longer is not a token.
const TOKEN = /^go:([a-z_]+)$/

// Strips every "{{...}}" from streamed text and records the valid destinations. A model reply is
// untrusted: it can only ever contribute an enum value, never a route, URL or action.
export class DestinationFilter {
  private buf = ''
  private found: Destination[] = []

  push(chunk: string): string {
    this.buf += chunk
    let out = ''
    for (;;) {
      const open = this.buf.indexOf('{{')
      if (open === -1) {
        const keep = this.buf.endsWith('{') ? 1 : 0 // a trailing "{" may begin "{{" in the next chunk
        out += this.buf.slice(0, this.buf.length - keep)
        this.buf = this.buf.slice(this.buf.length - keep)
        return out
      }
      out += this.buf.slice(0, open)
      const close = this.buf.indexOf('}}', open + 2)
      if (close === -1) {
        if (this.buf.length - open > MAX_TOKEN) {
          this.buf = this.buf.slice(open + 2) // not a token: drop the opener, keep the rest as text
          continue
        }
        this.buf = this.buf.slice(open) // might still become a token
        return out
      }
      const m = TOKEN.exec(this.buf.slice(open + 2, close))
      if (m && (DESTINATIONS as readonly string[]).includes(m[1]) && !this.found.includes(m[1] as Destination)) {
        this.found.push(m[1] as Destination)
      }
      this.buf = this.buf.slice(close + 2)
    }
  }

  flush(): string {
    const rest = this.buf.replace(/\{\{[\s\S]*$/, '')
    this.buf = ''
    return rest
  }

  destinations(): Destination[] {
    return Array.from(this.found)
  }
}
