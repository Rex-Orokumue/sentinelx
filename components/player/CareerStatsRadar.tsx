// Pentagon radar chart frame — no polygon plotted. Skill/Reaction/Strategy/
// Teamwork/Consistency aren't tracked anywhere in the schema, so this shows
// the mockup's chart shape honestly empty rather than filling it with
// invented numbers.
const AXES = ['Skill', 'Reaction', 'Strategy', 'Teamwork', 'Consistency']
const SIZE = 200
const CENTER = SIZE / 2
const RADIUS = 70

function pointAt(index: number, r: number): [number, number] {
  const angle = (Math.PI * 2 * index) / AXES.length - Math.PI / 2
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)]
}

export function CareerStatsRadar() {
  const rings = [1, 0.66, 0.33]
  const vertices = AXES.map((_, i) => pointAt(i, RADIUS))

  return (
    <section id="career-stats">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">Career Stats</h2>
      </div>
      <div className="rounded-xl border border-sx-border bg-sx-surface p-4">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto w-full max-w-[220px] overflow-hidden">
          {rings.map((scale) => (
            <polygon
              key={scale}
              points={AXES.map((_, i) => pointAt(i, RADIUS * scale).join(',')).join(' ')}
              fill="none"
              stroke="rgba(124,58,237,0.25)"
              strokeWidth={1}
            />
          ))}
          {vertices.map(([x, y], i) => (
            <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="rgba(124,58,237,0.25)" strokeWidth={1} />
          ))}
          {AXES.map((label, i) => {
            const [x, y] = pointAt(i, RADIUS + 18)
            // Anchor direction depends on which side of center the label
            // sits on, so text always grows INWARD (toward the pentagon)
            // rather than symmetrically outward from the anchor point —
            // otherwise a label near the left/right edge (e.g. the longest
            // words, "Consistency"/"Reaction") renders past the viewBox
            // boundary and gets clipped. This is robust to any label
            // length, not tuned to today's specific words.
            const anchor = x < CENTER - 2 ? 'start' : x > CENTER + 2 ? 'end' : 'middle'
            return (
              <text
                key={label}
                x={x}
                y={y}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="fill-sx-gray text-[9px] font-semibold uppercase"
              >
                {label}
              </text>
            )
          })}
        </svg>
        <p className="mt-2 text-center text-xs text-sx-gray">Career stats — not tracked yet.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-sx-border pt-4">
          {['K/D Ratio', 'Avg Match Score', 'MVP Awards', 'Clutch Wins'].map((label) => (
            <div key={label} className="rounded-lg bg-sx-bg p-2 text-center">
              <p className="font-display text-base font-bold text-sx-gray">—</p>
              <p className="text-[10px] uppercase tracking-wide text-sx-gray">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
