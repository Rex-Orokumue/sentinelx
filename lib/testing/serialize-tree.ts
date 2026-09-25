import { isValidElement, type ReactNode } from 'react'

function typeName(t: unknown): string {
  if (typeof t === 'string') return t
  const x = t as { displayName?: string; name?: string; render?: { name?: string } } | null
  return x?.displayName || x?.name || x?.render?.name || 'Anonymous'
}

function value(v: unknown): unknown {
  if (typeof v === 'function') return '[fn]'
  if (Array.isArray(v)) return v.map(value)
  if (isValidElement(v)) return serializeTree(v)
  if (v instanceof Map) return { __map: Array.from(v.entries()).map(([k, x]) => [value(k), value(x)]) }
  if (v instanceof Set) return { __set: Array.from(v.values()).map(value) }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)]))
  return v
}

/** Plain-JSON view of what an async Server Component returns, for snapshotting. Children components are NOT executed. */
export function serializeTree(node: ReactNode): unknown {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(serializeTree)
  if (isValidElement(node)) {
    const { children, ...props } = node.props as Record<string, unknown>
    return { t: typeName(node.type), props: value(props), children: serializeTree(children as ReactNode) }
  }
  return String(node)
}
