function parts(v: string): number[] {
  const core = v.split('+')[0]
  const nums = core.split('.').map((s) => Number.parseInt(s, 10))
  return nums.map((n) => (Number.isNaN(n) ? 0 : n))
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}
