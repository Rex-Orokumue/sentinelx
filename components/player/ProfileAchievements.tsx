import Link from 'next/link'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatMonthYear } from '@/lib/format'
import type { ProfileTitle } from '@/lib/players/profile'

export function ProfileAchievements({ titles }: { titles: ProfileTitle[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-white">Achievements</h2>
      {titles.length === 0 ? (
        <EmptyState icon="🏆" title="No titles yet" body="Win a tournament to claim your first title." />
      ) : (
        <div className="space-y-2">
          {titles.map((t) => {
            const date = formatMonthYear(t.date)
            return (
              <Link
                key={t.tournamentSlug}
                href={`/tournaments/${t.tournamentSlug}`}
                className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-violet-500/40"
              >
                <span className="text-2xl">🏆</span>
                <div className="min-w-0">
                  <p className="truncate font-bold text-white">{t.tournamentTitle}</p>
                  <p className="text-xs text-slate-500">
                    Champion{t.gameName ? ` · ${t.gameName}` : ''}{date ? ` · ${date}` : ''}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
