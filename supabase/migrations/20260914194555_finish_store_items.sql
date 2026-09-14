-- Finish the last 10 SX Coins Store items (see docs/superpowers — store item
-- images conversation, 2026-09-14). All 10 already existed and were already
-- `active`, but had no preview_url so /store rendered them as a generic
-- placeholder, and equipping a bubble_skin did nothing visible anywhere.

-- ---------------------------------------------------------------------------
-- Part 1: preview images for all 10 remaining items
-- ---------------------------------------------------------------------------
update public.store_items set preview_url = '/coin-items/theme-dark-void.webp'      where slug = 'theme_dark_void';
update public.store_items set preview_url = '/coin-items/theme-neon-grid.webp'      where slug = 'theme_neon_grid';
update public.store_items set preview_url = '/coin-items/theme-lagos-skyline.webp'  where slug = 'theme_lagos_skyline';
update public.store_items set preview_url = '/coin-items/username-purple.webp'      where slug = 'username_purple';
update public.store_items set preview_url = '/coin-items/username-gold.webp'        where slug = 'username_gold';
update public.store_items set preview_url = '/coin-items/username-red.webp'         where slug = 'username_red';
update public.store_items set preview_url = '/coin-items/username-teal.webp'        where slug = 'username_teal';
update public.store_items set preview_url = '/coin-items/bubble-mascot-classic.webp' where slug = 'bubble_classic_mascot';
update public.store_items set preview_url = '/coin-items/bubble-mascot-neon.webp'    where slug = 'bubble_neon_mascot';
update public.store_items set preview_url = '/coin-items/bubble-mascot-gold.webp'    where slug = 'bubble_gold_mascot';

-- ---------------------------------------------------------------------------
-- Part 2: bubble_skin becomes live, mirroring
-- 20260908074500_equipped_avatar_border.sql exactly, one category later.
-- Reversal of the "bubble_skin ... NOT part of this task ... leave it
-- unimplemented" scope note in docs/superpowers/plans/2026-08-15-phase2-
-- postship-fixes.md Task 4.1 — see lib/store/cosmetics.ts for the resolver.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists equipped_bubble_skin text;

comment on column public.profiles.equipped_bubble_skin is
  'Slug of this player''s equipped bubble_skin store item, or NULL. Maintained '
  'by the sync_equipped_bubble_skin trigger on player_store_items — never write '
  'it directly. Resolved to artwork via BUBBLE_SKIN_FRAMES in lib/store/cosmetics.ts.';

create or replace function public.sync_equipped_bubble_skin(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles p
     set equipped_bubble_skin = (
       select si.slug
         from public.player_store_items psi
         join public.store_items si on si.id = psi.item_id
        where psi.player_id = target
          and psi.equipped
          and si.category = 'bubble_skin'
        limit 1
     )
   where p.id = target;
$$;

create or replace function public.trg_sync_equipped_bubble_skin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_equipped_bubble_skin(old.player_id);
    return old;
  end if;

  perform public.sync_equipped_bubble_skin(new.player_id);

  if tg_op = 'UPDATE' and old.player_id is distinct from new.player_id then
    perform public.sync_equipped_bubble_skin(old.player_id);
  end if;

  return new;
end;
$$;

drop trigger if exists sync_equipped_bubble_skin on public.player_store_items;
create trigger sync_equipped_bubble_skin
after insert or update or delete on public.player_store_items
for each row execute function public.trg_sync_equipped_bubble_skin();

-- Backfill anyone who already has a bubble skin equipped.
update public.profiles p
   set equipped_bubble_skin = sub.slug
  from (
    select psi.player_id, si.slug
      from public.player_store_items psi
      join public.store_items si on si.id = psi.item_id
     where psi.equipped
       and si.category = 'bubble_skin'
  ) sub
 where sub.player_id = p.id
   and p.equipped_bubble_skin is distinct from sub.slug;
