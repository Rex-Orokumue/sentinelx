export interface SendResult {
  ok: boolean
  providerRef?: string
  error?: string
  skipped?: boolean
}

// Sends a WhatsApp message via Termii. No-ops when TERMII_API_KEY is unset, so the
// whole pipeline runs harmlessly until the account/templates are live.
// NOTE: the exact Termii request shape is finalized against the real account; this is
// isolated here so callers never change. Only runs when a key is present.
export async function sendWhatsApp(args: {
  to: string
  templateName: string
  body: string
}): Promise<SendResult> {
  const apiKey = process.env.TERMII_API_KEY
  if (!apiKey) return { ok: false, skipped: true }

  const baseUrl = process.env.TERMII_BASE_URL ?? 'https://api.ng.termii.com'
  const from = process.env.TERMII_SENDER_ID ?? ''
  try {
    const res = await fetch(`${baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        to: args.to,
        from,
        sms: args.body,
        channel: 'whatsapp',
        type: 'plain',
      }),
    })
    const json = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string }
    if (!res.ok) return { ok: false, error: json.message ?? `HTTP ${res.status}` }
    return { ok: true, providerRef: json.message_id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
