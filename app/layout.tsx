import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Rajdhani } from 'next/font/google'
import { AuthNav } from '@/components/shared/AuthNav'
import { SiteHeader } from '@/components/shared/SiteHeader'
import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

// Display font for the wordmark + headings — sporty/esports feel to match the logo.
const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
})

export const metadata: Metadata = {
  title: 'Sentinel X',
  description: "Nigeria's Home of Mobile Esports — Where Gamers Unite. Champions Rise.",
}

const WHATSAPP_COMMUNITY = process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '#'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${rajdhani.variable} bg-slate-950 font-sans text-white antialiased`}
      >
        <div className="flex min-h-screen flex-col">
          <SiteHeader authNav={<AuthNav />} whatsappUrl={WHATSAPP_COMMUNITY} />

          <main className="flex-1">{children}</main>

          <footer className="border-t border-slate-800 py-5 text-center text-xs text-slate-600">
            © {new Date().getFullYear()} Sentinel X · Nigeria's Home of Mobile Esports
          </footer>
        </div>
      </body>
    </html>
  )
}
