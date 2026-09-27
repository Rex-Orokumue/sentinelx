import { z } from 'zod'

export const registrationFieldSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(60, 'Label is too long'),
  placeholder: z.union([z.literal(''), z.string().trim().max(80, 'Placeholder is too long')]),
  inputType: z.enum(['text', 'number', 'url']),
  required: z.boolean(),
  validationPattern: z.union([z.literal(''), z.string().trim().max(200)]).refine(
    (v) => {
      if (!v) return true
      try {
        new RegExp(v)
        return true
      } catch {
        return false
      }
    },
    { message: 'Validation pattern must be a valid regular expression' },
  ),
  validationMessage: z.union([z.literal(''), z.string().trim().max(120)]),
  showOnBracket: z.boolean(),
})

export type RegistrationFieldInput = z.infer<typeof registrationFieldSchema>
