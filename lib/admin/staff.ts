import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Profile ids for every admin/moderator with a WhatsApp number on file — the
// recipient list for staff-facing alerts (e.g. a no-show that needs a
// decision). A staff member with no verified WhatsApp number is silently
// skipped, same as notify()'s existing "no recipient -> stays skipped"
// behavior — they'll still see the in-app admin notification bell.
export async function getNotifiableStaffIds(admin: Admin): Promise<string[]> {
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('user_id')
    .in('role', ['admin', 'moderator'])
  const staffIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)))
  if (staffIds.length === 0) return []

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, whatsapp_number')
    .in('id', staffIds)
    .not('whatsapp_number', 'is', null)
  return (profiles ?? []).map((p) => p.id)
}
