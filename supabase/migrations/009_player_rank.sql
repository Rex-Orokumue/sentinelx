-- Rank of a player among eligible players (total_matches >= 1), matching the
-- /rankings order: wins → win rate → titles → goal difference. Returns NULL for
-- an unranked player (0 matches) or unknown username.
-- NOTE: this tiebreak MUST mirror rankPlayers() in lib/rankings/leaderboard.ts.
CREATE OR REPLACE FUNCTION public.player_rank(uname text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  WITH p AS (
    SELECT wins, total_matches, total_titles, goals_scored, goals_conceded
    FROM public.profiles
    WHERE username = uname
  )
  SELECT CASE
    WHEN p.total_matches < 1 THEN NULL
    ELSE (
      SELECT count(*) + 1
      FROM public.profiles o, p
      WHERE o.total_matches >= 1
        AND (
          o.wins > p.wins
          OR (o.wins = p.wins
              AND o.wins::float / o.total_matches > p.wins::float / p.total_matches)
          OR (o.wins = p.wins
              AND o.wins::float / o.total_matches = p.wins::float / p.total_matches
              AND o.total_titles > p.total_titles)
          OR (o.wins = p.wins
              AND o.wins::float / o.total_matches = p.wins::float / p.total_matches
              AND o.total_titles = p.total_titles
              AND (o.goals_scored - o.goals_conceded) > (p.goals_scored - p.goals_conceded))
        )
    )
  END
  FROM p;
$$;
