export interface RosterMember {
  id: string
  name: string
  checkedIn: boolean
}

export interface SideInfo {
  id: string
  name: string
  roster: RosterMember[]
  anyCheckedIn: boolean
}

// Per-roster-member check-in visibility for a team match (spec §9 — "a
// per-roster-member attendance/result grid"). Purely informational: the
// per-player no_show consequence for someone who never checked in (spec
// §7.4) is automatic once the admin confirms a normal result, computed by
// teamMatchEventsFor — this grid is what lets the admin SEE that before they
// confirm, the same way the existing two-player check-in banner already
// does for solo matches. The scoreline itself stays one shared number per
// side, entered via the existing ResultReviewForms below this component.
export function RosterAttendanceGrid({ sideA, sideB }: { sideA: SideInfo | null; sideB: SideInfo | null }) {
  const sides = [sideA, sideB].filter((s): s is SideInfo => s != null)
  if (sides.length === 0) return null
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {sides.map((side) => (
        <div key={side.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="mb-2 text-xs font-bold text-white">{side.name}</p>
          <ul className="space-y-1 text-xs">
            {side.roster.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-slate-300">
                <span>{m.name}</span>
                <span className={m.checkedIn ? 'text-emerald-400' : 'text-slate-600'}>
                  {m.checkedIn ? '✓ Checked in' : '— Not checked in'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
