// Test-only recording fake for the service-role client: every chained call is logged as [method, args],
// and awaiting the chain (or calling maybeSingle/single) resolves to whatever `resolve` returns for that table.
export interface Op {
  table: string
  ops: [string, unknown[]][]
}
type Result = { data?: unknown; error?: { message: string; code?: string } | null }

export function fakeAdmin(resolve: (op: Op) => Result = () => ({ data: null, error: null }), rpcResult: Result = { error: null }) {
  const calls: Op[] = []
  const rpcCalls: [string, unknown][] = []
  const admin = {
    from(table: string) {
      const op: Op = { table, ops: [] }
      calls.push(op)
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') {
              return (res: (v: unknown) => unknown) => Promise.resolve({ error: null, ...resolve(op) }).then(res)
            }
            return (...args: unknown[]) => {
              op.ops.push([prop, args])
              if (prop === 'maybeSingle' || prop === 'single') return Promise.resolve({ error: null, ...resolve(op) })
              return proxy
            }
          },
        },
      )
      return proxy
    },
    rpc(name: string, args: unknown) {
      rpcCalls.push([name, args])
      return Promise.resolve(rpcResult)
    },
  }
  return { admin: admin as never, calls, rpcCalls }
}

export const methods = (op: Op) => op.ops.map(([m]) => m)
export const argsOf = (op: Op, method: string) => op.ops.find(([m]) => m === method)?.[1]
