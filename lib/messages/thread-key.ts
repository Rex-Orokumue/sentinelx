// The one place the normalised thread pair is computed. dm_threads has a
// CHECK (player_a < player_b) and UNIQUE (player_a, player_b), so A->B and B->A
// only map to the same row if every caller orders the pair identically.
export function orderedPair(x: string, y: string): { playerA: string; playerB: string } {
  if (x === y) throw new Error('a player cannot message themselves')
  return x < y ? { playerA: x, playerB: y } : { playerA: y, playerB: x }
}
