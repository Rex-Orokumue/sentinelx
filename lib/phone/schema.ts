import { z } from 'zod'

export const phoneCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, 'Enter the 6-digit code')
