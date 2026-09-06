// Minimal Resend wrapper. Best-effort by contract: returns false rather than
// throwing, so a failed email never aborts the deletion it accompanies —
// losing the notification is bad, losing the deletion the user asked for is
// worse.
//
// No-ops when unconfigured, the same pattern lib/notifications/termii.ts uses
// for TERMII_API_KEY, so local dev and CI never attempt a real send.
export async function sendEmail(input: {
  to: string
  subject: string
  html: string
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!key || !from) return false

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
    })
    if (!res.ok) {
      console.error('sendEmail failed', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (err) {
    console.error('sendEmail threw', err)
    return false
  }
}
