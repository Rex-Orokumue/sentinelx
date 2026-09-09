-- Equipped avatar frame, denormalised onto profiles.
--
-- Frames shipped rendering on exactly three surfaces — the dashboard, the
-- public profile page and ProfileHeader — because those were the only places
-- willing to pay for a player_store_items -> store_items join to find out
-- which frame is equipped. Everywhere else a player appears (community posts
-- and comments, leaderboards, the header account menu, brackets, match centre,
-- Hall of Fame, friends) rendered them bare. Someone spends coins on a frame
-- and then never sees it where other people actually look at them.
--
-- Carrying the slug on profiles fixes that structurally: every avatar query
-- already selects from profiles, so the frame comes along for free, with no
-- extra join anywhere and no way for a new page to forget it.
--
-- Maintained by trigger rather than by the equip action, so it stays correct
-- for equips made outside that action — admin SQL, a future bulk grant, a
-- refund that removes the row.

alter table public.profiles
  add column if not exists equipped_avatar_border text;

comment on column public.profiles.equipped_avatar_border is
  'Slug of this player''s equipped avatar_border store item, or NULL. Maintained '
  'by the sync_equipped_avatar_border trigger on player_store_items — never write '
  'it directly. Resolved to artwork via AVATAR_BORDER_FRAMES in lib/store/cosmetics.ts.';

-- Recompute one player's frame from the source of truth. LIMIT 1 because the
-- equip action already enforces one equipped item per category; if that ever
-- broke, showing one frame is a better failure than erroring.
create or replace function public.sync_equipped_avatar_border(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles p
     set equipped_avatar_border = (
       select si.slug
         from public.player_store_items psi
         join public.store_items si on si.id = psi.item_id
        where psi.player_id = target
          and psi.equipped
          and si.category = 'avatar_border'
        limit 1
     )
   where p.id = target;
$$;

create or replace function public.trg_sync_equipped_avatar_border()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_equipped_avatar_border(old.player_id);
    return old;
  end if;

  perform public.sync_equipped_avatar_border(new.player_id);

  -- A row moving between players has to leave the old one correct too. Not a
  -- thing the app does today, but the trigger is the safety net precisely for
  -- what the app does not do today.
  if tg_op = 'UPDATE' and old.player_id is distinct from new.player_id then
    perform public.sync_equipped_avatar_border(old.player_id);
  end if;

  return new;
end;
$$;

drop trigger if exists sync_equipped_avatar_border on public.player_store_items;
create trigger sync_equipped_avatar_border
after insert or update or delete on public.player_store_items
for each row execute function public.trg_sync_equipped_avatar_border();

-- Backfill everyone who already has a frame equipped.
update public.profiles p
   set equipped_avatar_border = sub.slug
  from (
    select psi.player_id, si.slug
      from public.player_store_items psi
      join public.store_items si on si.id = psi.item_id
     where psi.equipped
       and si.category = 'avatar_border'
  ) sub
 where sub.player_id = p.id
   and p.equipped_avatar_border is distinct from sub.slug;
