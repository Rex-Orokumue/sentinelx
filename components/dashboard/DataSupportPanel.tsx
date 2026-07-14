import { buildDataSupportClaimUrl } from '@/lib/dashboard/data-support'
import type { DataSupportEligibility } from '@/lib/dashboard/data-support'

export function DataSupportPanel({
  username,
  eligibility,
}: {
  username: string
  eligibility: DataSupportEligibility[]
}) {
  return (
    <div className="space-y-2">
      {eligibility.map((e) => {
        const url = buildDataSupportClaimUrl({
          whatsapp: e.whatsapp,
          username,
          tournamentTitle: e.tournamentTitle,
          stage: e.stage,
        })
        return (
          <div key={e.tournamentId} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <p className="font-bold text-white">{e.tournamentTitle}</p>
            <p className="mt-1 text-xs text-slate-400">{e.text}</p>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-5 py-2.5 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
              >
                Claim Data Support
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}
