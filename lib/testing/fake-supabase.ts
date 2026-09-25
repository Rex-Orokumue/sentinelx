type Row = Record<string, unknown>

// Numbers compare numerically, everything else (ISO date strings) lexicographically - correct for ISO-8601 UTC.
function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/**
 * In-memory stand-in for the Supabase query builder, for characterization and service tests.
 * It APPLIES eq/neq/in/gte/is/not filters to fixture rows (so a query's filters matter) and IGNORES
 * order/limit/select-column-lists/embedded selects (fixtures already carry the nested shape the code reads).
 * Every query is logged as `table:op|op(col)…` so tests can pin query count and shape.
 * Any method it does not implement throws — extend it deliberately, never silently.
 */
export function fakeSupabase(tables: Record<string, Row[]>, opts: { user?: { id: string } | null } = {}) {
  const queries: string[] = []

  function builder(table: string) {
    let rows: Row[] = (tables[table] ?? []).slice()
    let head = false
    let wantCount = false
    let single = false
    const ops: string[] = []

    const filter = (name: string, col: string, pred: (v: unknown) => boolean) => {
      ops.push(`${name}(${col})`)
      rows = rows.filter((r) => pred(r[col]))
      return proxy
    }

    const impl: Record<string, unknown> = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        ops.push('select')
        if (o?.count) wantCount = true
        if (o?.head) head = true
        return proxy
      },
      eq: (col: string, val: unknown) => filter('eq', col, (v) => v === val),
      neq: (col: string, val: unknown) => filter('neq', col, (v) => v !== val),
      gte: (col: string, val: unknown) => filter('gte', col, (v) => cmp(v, val) >= 0),
      lt: (col: string, val: unknown) => filter('lt', col, (v) => cmp(v, val) < 0),
      in: (col: string, vals: unknown[]) => filter('in', col, (v) => vals.includes(v)),
      is: (col: string, val: unknown) => filter('is', col, (v) => (v ?? null) === val),
      not: (col: string, _op: string, val: unknown) => filter('not', col, (v) => (v ?? null) !== val),
      order: () => proxy,
      limit: () => proxy,
      maybeSingle: () => {
        single = true
        return proxy
      },
      single: () => {
        single = true
        return proxy
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        queries.push(`${table}:${ops.join('|')}`)
        const data = head ? null : single ? rows[0] ?? null : rows
        return Promise.resolve({ data, count: wantCount ? rows.length : null, error: null }).then(resolve, reject)
      },
    }

    const proxy: unknown = new Proxy(impl, {
      get(target, prop) {
        if (typeof prop === 'symbol') return undefined
        if (prop in target) return target[prop]
        throw new Error(`fake-supabase: .${prop}() is not supported — implement it in lib/testing/fake-supabase.ts`)
      },
    })
    return proxy as Record<string, (...a: unknown[]) => unknown>
  }

  // Deliberately loose: production code takes the real SupabaseClient type; tests inject this via vi.mock / `as never`.
  const client = {
    // Test double: the chain is intentionally untyped so tests can call any supported builder method.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: string): any => builder(table),
    auth: { getUser: async () => ({ data: { user: opts.user ?? null }, error: null }) },
  }
  return { client, queries }
}
