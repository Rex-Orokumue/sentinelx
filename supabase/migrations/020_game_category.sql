-- Genre/category classification. 'other' is a deliberate catch-all for now —
-- #21 will split it into real values (fps, battle_royale, etc.) when those
-- games are actually added. Football-specific views (Goals tab, Golden Boot)
-- filter on category = 'football' and will simply show nothing for 'other'
-- games until #21 gives them their own stat columns and their own category.
ALTER TABLE public.games
  ADD COLUMN category text NOT NULL DEFAULT 'football'
    CHECK (category IN ('football', 'other'));
