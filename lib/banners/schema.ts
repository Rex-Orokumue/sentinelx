import { z } from 'zod'

export const bannerSchema = z.object({
  title: z.string().trim().min(1, 'Enter an internal title'),
  imageUrl: z.string().trim().url('Enter a valid image URL'),
  linkUrl: z.string().trim().url('Enter a valid link URL'),
})

export type BannerInput = z.infer<typeof bannerSchema>
