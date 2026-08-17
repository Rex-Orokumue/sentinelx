// Native <details>/<summary> — no client JS, matches the existing accordion
// pattern in app/(public)/tournaments/page.tsx's TournamentFaqCard.
export type FaqGroup = {
  heading: string
  items: { q: string; a: string }[]
}

export function FaqAccordion({ groups }: { groups: FaqGroup[] }) {
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.heading}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
            {group.heading}
          </h2>
          <div className="space-y-2">
            {group.items.map((item) => (
              <details key={item.q} className="group rounded-lg border border-sx-border bg-sx-surface p-4">
                <summary className="cursor-pointer text-sm font-semibold text-white marker:content-none">
                  {item.q}
                </summary>
                <p className="mt-2 text-sm text-sx-gray">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
