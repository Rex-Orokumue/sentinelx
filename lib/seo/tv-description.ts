export function tvDescription(liveMatchTitle: string | null): string {
  if (!liveMatchTitle) {
    return 'Watch live mobile esports, highlights, finals, and match replays on Sentinel X TV.'
  }
  return `${liveMatchTitle} is live now on Sentinel X TV — plus highlights, finals, and replays.`
}
