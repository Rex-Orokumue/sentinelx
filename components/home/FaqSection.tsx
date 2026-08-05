import type { FaqItem } from '@/lib/seo/schema/faq'

export function FaqSection({ items }: { items: FaqItem[] }) {
  return (
    <section className="mt-12 border-t border-sx-border pt-8">
      <h2 className="text-lg font-bold text-white">Frequently asked questions</h2>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <details key={item.question} className="rounded-xl border border-sx-border bg-sx-surface p-4" open>
            <summary className="cursor-pointer text-sm font-semibold text-white">{item.question}</summary>
            <p className="mt-2 text-sm text-sx-gray">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
