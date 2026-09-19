import { buildAssetLinks } from '@/lib/mobile-api/assetlinks'

export const dynamic = 'force-dynamic'

export function GET() {
  const body = buildAssetLinks(process.env.ANDROID_PACKAGE_NAME ?? 'ng.com.sentinelxesports.app', process.env.ANDROID_CERT_SHA256)
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  })
}
