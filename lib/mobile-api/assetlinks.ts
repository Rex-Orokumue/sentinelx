export function buildAssetLinks(packageName: string, fingerprints: string | undefined): unknown[] {
  const certs = (fingerprints ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (certs.length === 0) return []
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: certs },
    },
  ]
}
