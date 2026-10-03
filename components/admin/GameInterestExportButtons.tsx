'use client'
import { useState } from 'react'
import { exportContactNumbers, exportContactCsv } from '@/lib/games/game-interest-admin-actions'

export function GameInterestExportButtons({ game, country }: { game?: string; country?: string }) {
  const [copied, setCopied] = useState(false)

  async function copyNumbers() {
    const { numbers } = await exportContactNumbers(game, country)
    await navigator.clipboard.writeText(numbers.join(', '))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function downloadCsv() {
    const { csv } = await exportContactCsv(game, country)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'game-interest-contacts.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex gap-2">
      <button type="button" onClick={copyNumbers} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {copied ? 'Copied!' : 'Copy Numbers'}
      </button>
      <button type="button" onClick={downloadCsv} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-white hover:border-slate-500">
        Download CSV
      </button>
    </div>
  )
}
