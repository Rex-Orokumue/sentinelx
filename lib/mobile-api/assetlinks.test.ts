import { describe, it, expect } from 'vitest'
import { buildAssetLinks } from './assetlinks'

describe('buildAssetLinks', () => {
  it('emits the Digital Asset Links statement for the app', () => {
    expect(buildAssetLinks('ng.com.sentinelxesports.app', 'AA:BB, CC:DD')).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'ng.com.sentinelxesports.app',
          sha256_cert_fingerprints: ['AA:BB', 'CC:DD'],
        },
      },
    ])
  })
  it('returns an empty list until a fingerprint is configured (never a statement with no certs)', () => {
    expect(buildAssetLinks('x.y', undefined)).toEqual([])
    expect(buildAssetLinks('x.y', ' , ')).toEqual([])
  })
})
