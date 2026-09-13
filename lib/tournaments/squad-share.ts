import { SITE_URL } from '@/lib/seo/site'

// Same plain wa.me/?text= pattern as every other share surface on the
// platform (spec §9, matching lib/community/whatsapp.ts).
export function squadInviteShareUrl(args: {
  tournamentTitle: string
  tournamentSlug: string
  squadName: string
  inviteCode: string
}): string {
  const link = `${SITE_URL}/tournaments/${args.tournamentSlug}`
  const text =
    `🎮 Join my squad "${args.squadName}" for ${args.tournamentTitle} on SentinelX!\n` +
    `Invite code: ${args.inviteCode}\n${link}`
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
