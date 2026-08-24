import { buildMetadata } from '@/lib/seo/metadata'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'

export const metadata = buildMetadata({
  title: 'Community Rules',
  description: "The standards that keep SentinelX's community positive, competitive, and safe.",
  path: '/community-rules',
})

export default function CommunityRulesPage() {
  return (
    <StaticPageShell eyebrow="Community" title="Community Rules">
      <div className={proseClassName}>
        <p>
          SentinelX is Nigeria&apos;s home of mobile esports. The community is for everyone who loves the
          game — we keep it positive, competitive, and safe.
        </p>

        <h2>The Basic Standard</h2>
        <p>
          Treat every member the way you&apos;d want to be treated at a tournament in person. Behind every
          username is a real person.
        </p>

        <h2>What&apos;s Not Allowed</h2>
        <h3>Harassment and hate speech</h3>
        <p>
          No insults, threats, or discrimination based on tribe, religion, gender, region, or any other
          personal characteristic. This includes DMs.
        </p>
        <h3>Spam</h3>
        <p>No repeated posting of the same content, no promotional links without permission, no bot activity.</p>
        <h3>False information</h3>
        <p>Do not post fake match results, fake screenshots, or misleading claims about other players.</p>
        <h3>Privacy violations</h3>
        <p>
          Do not share another player&apos;s personal information (phone number, address, real name if they
          use a username) without their consent.
        </p>
        <h3>Cheating promotion</h3>
        <p>Do not share or promote methods for cheating in any game supported on the platform.</p>
        <h3>NSFW content</h3>
        <p>No explicit, violent, or disturbing content of any kind.</p>

        <h2>Consequences</h2>
        <p>
          <strong>First offence:</strong> Warning
          <br />
          <strong>Second offence:</strong> Temporary suspension (7–30 days depending on severity)
          <br />
          <strong>Serious offences</strong> (hate speech, threats, doxxing, cheating): Immediate suspension or
          permanent ban, no warning required
        </p>

        <h2>Reporting</h2>
        <p>
          See something that breaks these rules? Use the report button on any post, or email{' '}
          <a href="mailto:sentinelxesports@gmail.com">sentinelxesports@gmail.com</a>. Reports are reviewed by
          the admin team. We take every report seriously.
        </p>
      </div>
    </StaticPageShell>
  )
}
