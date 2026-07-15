import { z } from 'zod'

export const bannerSchema = z.object({
  title: z.string().trim().min(1, 'Enter an internal title'),
  imageUrl: z.string().trim().url('Enter a valid image URL'),
  // Accepts either a same-site path (e.g. /tournaments/season-2) or an absolute URL.
  linkUrl: z
    .string()
    .trim()
    .refine((v) => v.startsWith('/') || z.string().url().safeParse(v).success, 'Enter a valid link URL'),
})

export type BannerInput = z.infer<typeof bannerSchema>
