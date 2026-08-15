export function SectionHeader({
  icon,
  title,
  subtitle,
  tone = 'default',
}: {
  icon: string
  title: string
  subtitle: string
  tone?: 'default' | 'gold' | 'purple'
}) {
  const titleClass = tone === 'gold' ? 'text-amber-400' : tone === 'purple' ? 'text-sx-purple-text' : 'text-white'
  return (
    <div className="mb-6">
      <h2 className={`font-display text-2xl font-black uppercase ${titleClass}`}>
        {icon} {title}
      </h2>
      <p className="mt-1 text-sm text-sx-gray">{subtitle}</p>
    </div>
  )
}
