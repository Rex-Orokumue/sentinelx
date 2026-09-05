import type { ReactNode } from 'react'
import { ExchangeSubHeader } from '@/components/exchange/ExchangeSubHeader'

// Wraps every route in the section — the listing grid, a listing detail, the
// sell form and the buy-request form — so the Exchange identity and its nav
// are present on all of them rather than only on the landing hero.
export default function ExchangeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ExchangeSubHeader />
      {children}
    </>
  )
}
