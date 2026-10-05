import { describe, it, expect } from 'vitest'
import { DestinationFilter } from './destinations'

function run(chunks: string[]) {
  const f = new DestinationFilter()
  let text = ''
  for (const c of chunks) text += f.push(c)
  text += f.flush()
  return { text, dest: f.destinations() }
}

describe('DestinationFilter', () => {
  it('removes a token and records the destination', () => {
    expect(run(['Open your wallet {{go:wallet}} now'])).toEqual({ text: 'Open your wallet  now', dest: ['wallet'] })
  })
  it('handles a token split across arbitrary chunk boundaries', () => {
    const msg = 'a {{go:tournaments}} b'
    for (let i = 1; i < msg.length; i++) {
      const r = run([msg.slice(0, i), msg.slice(i)])
      expect(r.text, `split at ${i}`).toBe('a  b')
      expect(r.dest).toEqual(['tournaments'])
    }
  })
  it('handles one character per chunk', () => {
    const r = run('a {{go:wallet}} b {{go:rules}}'.split(''))
    expect(r.text).toBe('a  b ')
    expect(r.dest).toEqual(['wallet', 'rules'])
  })
  it('drops unknown destinations and never leaks the braces', () => {
    const r = run(['x {{go:evil}} {{rm -rf}} y'])
    expect(r.dest).toEqual([])
    expect(r.text).not.toContain('{{')
    expect(r.text).not.toContain('go:')
  })
  it('dedupes destinations and keeps first-seen order', () => {
    expect(run(['{{go:wallet}}{{go:matches}}{{go:wallet}}']).dest).toEqual(['wallet', 'matches'])
  })
  it('drops an unterminated token at end of stream', () => {
    expect(run(['hello {{go:wal'])).toEqual({ text: 'hello ', dest: [] })
  })
  it('keeps a lone brace that is not a token', () => {
    expect(run(['a { b } c']).text).toBe('a { b } c')
  })
  it('does not swallow the reply when "{{" is never closed and the text is long', () => {
    const r = run(['{{', 'x'.repeat(200)])
    expect(r.text.length).toBeGreaterThan(150)
    expect(r.text).not.toContain('{{')
  })
  it('never leaks the opener for a nested token', () => {
    expect(run(['{{go:{{go:wallet}}}}']).text).not.toContain('{{')
  })
})
