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
export function fakeSupabase(
  tables: Record<string, Row[]>,
  opts: {
    user?: { id: string } | null
    rpc?: Record<string, (args: never) => unknown>
    // table -> column list that must be jointly unique; a violating insert resolves with error.code '23505'.
    unique?: Record<string, string[]>
  } = {},
) {
  const queries: string[] = []

  function builder(table: string) {
    let rows: Row[] = (tables[table] ?? []).slice()
    let head = false
    let wantCount = false
    let single = false
    let mutation: 'insert' | 'update' | null = null
    let mutationError: { code: string; message: string } | null = null
    let affected: Row[] = []
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
      gt: (col: string, val: unknown) => filter('gt', col, (v) => cmp(v, val) > 0),
      lte: (col: string, val: unknown) => filter('lte', col, (v) => cmp(v, val) <= 0),
      // ILIKE with no wildcards = case-insensitive equality. `\_` / `\%` escapes are honoured; real wildcards are not.
      ilike: (col: string, val: string) => {
        const lit = String(val).replace(/\\([_%\\])/g, '$1').toLowerCase()
        return filter('ilike', col, (v) => String(v ?? '').toLowerCase() === lit)
      },
      // Mutations apply to the shared fixture arrays so a test can assert what was written.
      insert: (payload: Row | Row[]) => {
        ops.push('insert')
        mutation = 'insert'
        const list = Array.isArray(payload) ? payload : [payload]
        const target = (tables[table] ??= [])
        const uniq = opts.unique?.[table]
        for (const r of list) {
          if (uniq && target.some((e) => uniq.every((c) => e[c] === r[c]))) {
            mutationError = { code: '23505', message: `duplicate key on ${table}` }
            break
          }
          const row = { ...r }
          target.push(row)
          affected.push(row)
        }
        return proxy
      },
      update: (patch: Row) => {
        ops.push('update')
        mutation = 'update'
        // filters chained after update() narrow `rows`; apply the patch lazily in then().
        impl.__patch = patch
        return proxy
      },
      lt: (col: string, val: unknown) => filter('lt', col, (v) => cmp(v, val) < 0),
      in: (col: string, vals: unknown[]) => filter('in', col, (v) => vals.includes(v)),
      is: (col: string, val: unknown) => filter('is', col, (v) => (v ?? null) === val),
      not: (col: string, _op: string, val: unknown) => filter('not', col, (v) => (v ?? null) !== val),
      // .or() takes a PostgREST filter-list string the fake cannot evaluate: it is RECORDED in the query log
      // but does not narrow rows, so fixtures for or()-filtered queries must already be pre-shaped.
      or: () => {
        ops.push('or')
        return proxy
      },
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
        if (mutation === 'update') {
          for (const r of rows) Object.assign(r, impl.__patch as Row)
          affected = rows
        }
        const out = mutation ? affected : rows
        const data = head ? null : single ? out[0] ?? null : out
        return Promise.resolve({ data, count: wantCount ? out.length : null, error: mutationError }).then(resolve, reject)
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
    rpc: async (name: string, args: unknown) => {
      queries.push(`rpc:${name}`)
      const fn = opts.rpc?.[name]
      if (!fn) throw new Error(`fake-supabase: no rpc fixture for ${name}`)
      return { data: fn(args as never), error: null }
    },
    auth: { getUser: async () => ({ data: { user: opts.user ?? null }, error: null }) },
  }
  return { client, queries }
}
