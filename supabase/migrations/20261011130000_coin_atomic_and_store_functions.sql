-- Atomic coin balance changes and store purchase/equip. Replaces the read-modify-write in
-- lib/coins/service.ts and the hand-rolled purchase in lib/coins/actions.ts. Service-role only.
CREATE OR REPLACE FUNCTION public.coin_apply(
  p_player      uuid,
  p_delta       integer,
  p_source      text,
  p_reference   uuid,
  p_description text,
  p_clamp       boolean
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old     integer;
  v_new     integer;
  v_applied integer;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'coin_apply: delta must not be zero';
  END IF;

  INSERT INTO sx_coins (player_id) VALUES (p_player) ON CONFLICT (player_id) DO NOTHING;
  -- The row lock serialises every coin change for this player.
  SELECT balance INTO v_old FROM sx_coins WHERE player_id = p_player FOR UPDATE;

  IF p_clamp THEN
    v_new := greatest(0, v_old + p_delta);          -- today's behaviour: floor at zero
  ELSE
    v_new := v_old + p_delta;
    IF v_new < 0 THEN
      RETURN NULL;                                    -- strict: refuse an overdraft, write nothing
    END IF;
  END IF;
  v_applied := v_new - v_old;

  UPDATE sx_coins
     SET balance      = v_new,
         total_earned = total_earned + greatest(0, v_applied),
         total_spent  = total_spent  + greatest(0, -v_applied),
         updated_at   = now()
   WHERE player_id = p_player;

  INSERT INTO sx_coin_transactions (player_id, amount, balance_after, source, reference_id, description)
  VALUES (p_player, v_applied, v_new, p_source, p_reference, p_description);

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_purchase(p_player uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item    store_items%ROWTYPE;
  v_balance integer;
BEGIN
  SELECT * INTO v_item FROM store_items WHERE id = p_item FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF NOT v_item.active THEN RETURN jsonb_build_object('status', 'inactive'); END IF;

  -- Lock this player's coin row first: concurrent purchases by the same player queue up here, so the
  -- ownership check below cannot be raced.
  INSERT INTO sx_coins (player_id) VALUES (p_player) ON CONFLICT (player_id) DO NOTHING;
  PERFORM 1 FROM sx_coins WHERE player_id = p_player FOR UPDATE;

  IF EXISTS (SELECT 1 FROM player_store_items WHERE player_id = p_player AND item_id = p_item) THEN
    RETURN jsonb_build_object('status', 'owned');
  END IF;

  v_balance := coin_apply(p_player, -v_item.price_coins, 'store_purchase', p_item, v_item.name, false);
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('status', 'insufficient',
      'balance', (SELECT balance FROM sx_coins WHERE player_id = p_player));
  END IF;

  INSERT INTO player_store_items (player_id, item_id) VALUES (p_player, p_item);
  RETURN jsonb_build_object('status', 'ok', 'balance', v_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.store_equip(p_player uuid, p_item uuid, p_equipped boolean) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
BEGIN
  SELECT category INTO v_category FROM store_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  IF NOT EXISTS (SELECT 1 FROM player_store_items WHERE player_id = p_player AND item_id = p_item) THEN
    RETURN jsonb_build_object('status', 'not_owned');
  END IF;

  IF p_equipped THEN
    -- One statement: this item on, every other owned item of the category off.
    UPDATE player_store_items psi
       SET equipped = (psi.item_id = p_item)
      FROM store_items si
     WHERE si.id = psi.item_id AND psi.player_id = p_player AND si.category = v_category;
  ELSE
    UPDATE player_store_items SET equipped = false WHERE player_id = p_player AND item_id = p_item;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'category', v_category);
END;
$$;

REVOKE ALL ON FUNCTION public.coin_apply(uuid, integer, text, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_purchase(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_equip(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coin_apply(uuid, integer, text, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_purchase(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_equip(uuid, uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
