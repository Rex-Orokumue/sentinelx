import { z } from 'zod'
import { isValidInviteCodeShape } from './squad-lifecycle'

// 2-30 chars, matching squads_name_length in
// supabase/migrations/20260909091000_tournament_entrants.sql — this schema
// must never accept what that CHECK constraint would reject.
export const squadNameSchema = z
  .string()
  .trim()
  .min(2, 'Squad name must be at least 2 characters')
  .max(30, 'Squad name is too long')

export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidInviteCodeShape, { message: 'Enter a valid 8-character invite code' })
