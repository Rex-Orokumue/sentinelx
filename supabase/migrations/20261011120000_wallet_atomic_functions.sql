-- Atomic wallet mutations. Replaces the read-modify-write in lib/wallet/service.ts, which could
-- lose an update when two writers read the same balance. Service-role only.
CREATE OR REPLACE FUNCTION public.wallet_apply(
  p_player    uuid,
  p_delta     integer,
  p_type      text,
  p_reference uuid,
  p_note      text,
  p_category  text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'wallet_apply: delta must not be zero';
  END IF;

  IF p_delta > 0 THEN
    INSERT INTO wallets (player_id, balance) VALUES (p_player, 0)
    ON CONFLICT (player_id) DO NOTHING;
  END IF;

  UPDATE wallets
     SET balance = balance + p_delta, updated_at = now()
   WHERE player_id = p_player AND balance + p_delta >= 0
  RETURNING balance INTO v_balance;

  IF NOT FOUND THEN
    RETURN NULL; -- insufficient balance (or no wallet on a debit); nothing was written
  END IF;

  INSERT INTO wallet_transactions (player_id, amount, type, reference_id, note, category)
  VALUES (p_player, p_delta, p_type, p_reference, p_note, p_category);

  RETURN v_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_request_withdrawal(
  p_player         uuid,
  p_amount         integer,
  p_bank_name      text,
  p_account_number text,
  p_account_name   text,
  p_category       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_balance integer;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'wallet_request_withdrawal: amount must be positive';
  END IF;

  BEGIN
    INSERT INTO withdrawal_requests (player_id, amount, bank_name, account_number, account_name, status)
    VALUES (p_player, p_amount, p_bank_name, p_account_number, p_account_name, 'pending')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'pending_exists');
  END;

  v_balance := wallet_apply(p_player, -p_amount, 'withdrawal_request', v_id, NULL, p_category);
  IF v_balance IS NULL THEN
    DELETE FROM withdrawal_requests WHERE id = v_id; -- same transaction: never visible to anyone
    RETURN jsonb_build_object('status', 'insufficient');
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'id', v_id, 'balance', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_apply(uuid, integer, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_request_withdrawal(uuid, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_apply(uuid, integer, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_request_withdrawal(uuid, integer, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
