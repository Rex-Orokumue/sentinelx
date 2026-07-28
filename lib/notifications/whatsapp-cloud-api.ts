export interface SendResult {
  ok: boolean
  providerRef?: string
  error?: string
  skipped?: boolean
}

// Sends a WhatsApp OTP via Meta's own Cloud API — free per-message within
// Meta's monthly allowance, unlike Termii (lib/notifications/termii.ts),
// which charges per message. No-ops when the Meta app isn't configured yet,
// so requestPhoneCode still succeeds harmlessly (skipped) until the
// Business account/template is live — same pattern as sendWhatsApp() in
// termii.ts.
export async function sendWhatsAppOtp(args: { to: string; code: string }): Promise<SendResult> {
  const token = process.env.META_WHATSAPP_TOKEN
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return { ok: false, skipped: true }

  const templateName = process.env.META_WHATSAPP_OTP_TEMPLATE ?? 'otp_verification'
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: args.to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en_US' },
          // Assumes a single {{1}} body variable (the code) — Meta's standard
          // Authentication template shape. If the approved template adds
          // extra components (e.g. a one-tap copy-code button), this
          // `components` array must be updated to match it exactly.
          components: [{ type: 'body', parameters: [{ type: 'text', text: args.code }] }],
        },
      }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[]
      error?: { message?: string }
    }
    if (!res.ok) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` }
    return { ok: true, providerRef: json.messages?.[0]?.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
