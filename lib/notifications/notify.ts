import { createAdminClient } from '@/lib/supabase/admin'
import { renderTemplate, type TemplateInput } from './templates'
import { sendWhatsApp } from './termii'

export type NotifyInput = TemplateInput & { playerId: string; dedupeKey: string }

// Best-effort: NEVER throws into the caller's primary action. Logs every attempt
// (insert-first with status='skipped'), dedupes on the UNIQUE dedupe_key, then
// upgrades the row to 'sent'/'failed' based on the send result.
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const { templateName, body } = renderTemplate(input)
    const admin = createAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('whatsapp_number')
      .eq('id', input.playerId)
      .maybeSingle()
    const toNumber = profile?.whatsapp_number ?? null

    // Insert-first, conservative default; on dedupe_key conflict this inserts nothing
    // and returns no row → idempotent early return.
    const { data: inserted } = await admin
      .from('notifications')
      .upsert(
        {
          player_id: input.playerId,
          type: input.type,
          to_number: toNumber,
          template_name: templateName,
          body,
          status: 'skipped',
          dedupe_key: input.dedupeKey,
        },
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()

    if (!inserted) return // duplicate (already handled) or insert failed → stop
    if (!toNumber) return // no recipient → stays 'skipped'

    const result = await sendWhatsApp({ to: toNumber, templateName, body })
    if (result.skipped) return // no provider configured → stays 'skipped'

    if (result.ok) {
      await admin
        .from('notifications')
        .update({
          status: 'sent',
          provider_reference: result.providerRef ?? null,
          sent_at: new Date().toISOString(),
        })
        .eq('id', inserted.id)
    } else {
      await admin
        .from('notifications')
        .update({ status: 'failed', error: result.error ?? 'unknown error' })
        .eq('id', inserted.id)
    }
  } catch {
    // best-effort — swallow so the caller's action is never affected
  }
}
