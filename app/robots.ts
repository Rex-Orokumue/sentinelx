import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/dashboard', '/api', '/login', '/signup', '/forgot-password', '/reset-password'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
