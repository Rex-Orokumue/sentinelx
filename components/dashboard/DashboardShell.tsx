import { DashboardSidebar } from './DashboardSidebar'
import { DashboardPushBanner } from '@/components/notifications/DashboardPushBanner'

// A plain component, not a Next.js layout.tsx — see plan Global Constraints
// for why (it would otherwise nest around app/dashboard/wallet's own shell).
// Every dashboard page wraps its own content in this explicitly.
export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="flex flex-col gap-6 py-4 sm:flex-row">
        <DashboardSidebar />
        <div className="min-w-0 flex-1 space-y-6">
          <DashboardPushBanner />
          {children}
        </div>
      </div>
    </div>
  )
}
