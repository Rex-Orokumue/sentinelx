import { z } from 'zod'

// PostgreSQL's uuid type validates the 8-4-4-4-12 hexadecimal shape but does
// not require RFC version/variant bits. Values crossing a database boundary
// should use the database's rule rather than z.uuid()'s stricter RFC rule.
export const postgresUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
