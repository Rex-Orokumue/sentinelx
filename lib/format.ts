// Single source of truth for naira display. ₦ + Nigerian digit grouping.
export function formatNaira(n: number): string {
  return `₦${n.toLocaleString('en-NG')}`
}
