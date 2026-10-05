// scripts/chat-eval.ts — the ten-question section-selection eval against REAL Groq (spends a few cents of credit).
// OWNER-GATED: run it only after the owner approves, with the staging GROQ_API_KEY in .env.local (never committed).
// Usage: npx tsx scripts/chat-eval.ts
//
// Pass rule: tool-needing cases must request a SUPERSET of the expected sections and at most 3 sections; the "none"
// case must request no tool. Prints each case, the sections asked and finish_reason; exits 1 on any failure. It also
// reports whether finish_reason was ever 'length' and the visible reply length for a normal FAQ question, which
// confirms the reasoning-token assumption behind CHAT_MAX_OUTPUT_TOKENS.
import { loadEnvConfig } from '@next/env'
import Groq from 'groq-sdk'
import { buildSystemPrompt } from '@/lib/chat/system-prompt'
import { CHAT_TOOLS } from '@/lib/chat/tools'
import { unionSections, type Section } from '@/lib/chat/sections'
import { CHAT_MODEL, CHAT_MAX_OUTPUT_TOKENS } from '@/lib/chat/service'

loadEnvConfig(process.cwd())

const CASES: Array<{ q: string; expect: Section[] | 'none' }> = [
  { q: 'when is my next match?', expect: ['matches'] },
  { q: 'how much is in my wallet?', expect: ['wallet'] },
  { q: 'how many SX coins do I have?', expect: ['wallet'] },
  { q: 'where is my withdrawal?', expect: ['withdrawals'] },
  { q: 'am I verified to withdraw prizes?', expect: ['kyc'] },
  { q: 'did my tournament payment go through?', expect: ['registrations'] },
  { q: 'what is my SX Score and tier?', expect: ['score'] },
  { q: 'do I have any friendly matches pending?', expect: ['friendlies'] },
  { q: 'how many unread notifications do I have?', expect: ['notifications'] },
  { q: 'how does the tournament entry fee work?', expect: 'none' },
]

async function main() {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    console.error('GROQ_API_KEY is not set (put the staging key in .env.local). Nothing was run.')
    process.exit(2)
  }
  const groq = new Groq({ apiKey: key })
  const system = { role: 'system' as const, content: buildSystemPrompt({ isLoggedIn: true, locale: 'en' }) }
  let failures = 0
  for (const c of CASES) {
    const res = await groq.chat.completions.create({
      model: CHAT_MODEL,
      reasoning_effort: 'low',
      max_completion_tokens: CHAT_MAX_OUTPUT_TOKENS,
      messages: [system, { role: 'user', content: c.q }],
      tools: CHAT_TOOLS,
      tool_choice: 'auto',
    })
    const choice = res.choices[0]
    const asked = unionSections((choice.message.tool_calls ?? []).map((t) => t.function.arguments ?? ''))
    const ok =
      c.expect === 'none'
        ? (choice.message.tool_calls ?? []).length === 0
        : c.expect.every((s) => asked.includes(s)) && asked.length <= 3
    if (!ok) failures++
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.q}\n      expected=${JSON.stringify(c.expect)} asked=${JSON.stringify(asked)} finish=${choice.finish_reason}` +
        (c.expect === 'none' ? ` replyChars=${(choice.message.content ?? '').length}` : ''),
    )
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} passed`)
  process.exit(failures === 0 ? 0 : 1)
}
void main()
