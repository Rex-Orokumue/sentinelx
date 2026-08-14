import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Stub — replaced with the real implementation in Task 4.3 (Part 4: Achievement System).
export async function checkAndUnlockAchievements(_admin: Admin, _playerId: string, _context: unknown): Promise<void> {
  // no-op until Task 4.3
}
