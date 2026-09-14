import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo/site'

const DISALLOW = ['/admin', '/dashboard', '/api', '/login', '/signup', '/forgot-password', '/reset-password']

// Named explicitly (rather than relying on the '*' wildcard alone) so answer
// engines and AI crawlers see an unambiguous, intentional allow — the actual
// AEO lever. Covers the major search-driven AI crawlers (live retrieval /
// answer generation) and the major bulk model-training crawlers alike; the
// platform wants to be citable in AI answers about Nigerian mobile esports.
const AI_USER_AGENTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'CCBot',
  'anthropic-ai',
  'cohere-ai',
  'Applebot-Extended',
  'Bytespider',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      ...AI_USER_AGENTS.map((userAgent) => ({ userAgent, allow: '/', disallow: DISALLOW })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
