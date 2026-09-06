// Shape of the homepage champion teaser. The builder that used to live here
// resolved the latest *Champions Cup* winner only — the same DLS-structure
// assumption that hid the FC Mobile champion from the Hall of Fame, and it
// rendered nothing because no Champions Cup has been played. The homepage now
// uses fetchChampions + latestChampion from lib/tournaments/champions.ts, which
// covers every game and every tournament type.
export interface HallOfFameTeaserData {
  slug: string
  title: string
  prizePool: number
  gameName: string | null
  championName: string
}
