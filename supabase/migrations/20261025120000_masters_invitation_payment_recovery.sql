-- Invitation payment attempts survive checkout retries. All writes are service-role only.
ALTER TABLE public.tournament_registrations
  ADD COLUMN payment_source text CHECK (payment_source IN ('paystack', 'wallet', 'free')),
  ADD COLUMN paid_attempt_id uuid;

CREATE TABLE public.tournament_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.tournament_registrations(id) ON DELETE CASCADE,
  paystack_reference text NOT NULL UNIQUE,
  credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tournament_payment_attempts_registration_idx ON public.tournament_payment_attempts(registration_id);
ALTER TABLE public.tournament_payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tournament_payment_attempts_staff_read ON public.tournament_payment_attempts
  FOR SELECT USING (public.is_staff());
REVOKE INSERT, UPDATE, DELETE ON public.tournament_payment_attempts FROM anon, authenticated;

ALTER TABLE public.tournament_registrations
  ADD CONSTRAINT tournament_registrations_paid_attempt_fkey
  FOREIGN KEY (paid_attempt_id) REFERENCES public.tournament_payment_attempts(id);

-- Preserve in-flight invitation checkouts that predate this migration.
INSERT INTO public.tournament_payment_attempts (registration_id, paystack_reference)
SELECT r.id, r.paystack_reference
FROM public.tournament_registrations r
JOIN public.tournament_invitations i
  ON i.tournament_id = r.tournament_id AND i.player_id = r.player_id
WHERE i.status = 'accepted' AND r.paystack_reference IS NOT NULL
ON CONFLICT (paystack_reference) DO NOTHING;

ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'prize', 'referral', 'friendly_stake', 'admin_credit',
    'withdrawal_request', 'withdrawal_reversal',
    'bet_stake', 'bet_payout', 'bet_refund', 'deposit',
    'registration_entry', 'registration_overpayment'
  ));
CREATE UNIQUE INDEX wallet_registration_payment_once
  ON public.wallet_transactions (type, reference_id)
  WHERE type IN ('registration_entry', 'registration_overpayment');

CREATE OR REPLACE FUNCTION public.accept_invitation_registration(p_player uuid, p_invitation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.tournament_invitations%ROWTYPE;
  v_t public.tournaments%ROWTYPE;
  v_reg public.tournament_registrations%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM public.tournament_invitations WHERE id = p_invitation FOR UPDATE;
  IF NOT FOUND OR v_inv.player_id <> p_player THEN
    RETURN jsonb_build_object('status', 'invitation_not_found');
  END IF;
  IF v_inv.status NOT IN ('pending', 'accepted') THEN
    RETURN jsonb_build_object('status', 'invitation_no_longer_available');
  END IF;
  IF v_inv.status = 'pending' AND v_inv.expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'invitation_expired');
  END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = v_inv.tournament_id;
  IF NOT FOUND OR v_t.status <> 'registration_open' THEN
    RETURN jsonb_build_object('status', 'registration_closed');
  END IF;

  IF v_inv.status = 'pending' THEN
    UPDATE public.tournament_invitations
       SET status = 'accepted', responded_at = now()
     WHERE id = v_inv.id;
  END IF;
  INSERT INTO public.tournament_registrations (tournament_id, player_id, payment_status)
  VALUES (v_t.id, p_player, CASE WHEN v_t.registration_fee <= 0 THEN 'paid' ELSE 'pending' END)
  ON CONFLICT (tournament_id, player_id) DO NOTHING;
  SELECT * INTO v_reg FROM public.tournament_registrations
   WHERE tournament_id = v_t.id AND player_id = p_player FOR UPDATE;
  IF v_t.registration_fee <= 0 AND v_reg.payment_status = 'paid' THEN
    UPDATE public.tournament_registrations SET payment_source = COALESCE(payment_source, 'free') WHERE id = v_reg.id;
  END IF;
  RETURN jsonb_build_object(
    'status', CASE WHEN v_reg.payment_status = 'paid' THEN 'confirmed' ELSE 'pending' END,
    'tournamentId', v_t.id, 'tournamentSlug', v_t.slug, 'tournamentTitle', v_t.title,
    'fee', v_t.registration_fee, 'registrationId', v_reg.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_invitation_from_wallet(p_player uuid, p_invitation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_accept jsonb;
  v_reg uuid;
  v_fee integer;
  v_balance integer;
BEGIN
  BEGIN
    v_accept := public.accept_invitation_registration(p_player, p_invitation);
    IF v_accept->>'status' <> 'pending' THEN RETURN v_accept; END IF;
    v_reg := (v_accept->>'registrationId')::uuid;
    v_fee := (v_accept->>'fee')::integer;
    v_balance := public.wallet_apply(
      p_player, -v_fee, 'registration_entry', v_reg,
      'Tournament entry fee', 'entry_fee'
    );
    IF v_balance IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'insufficient wallet balance';
    END IF;
    UPDATE public.tournament_registrations
       SET payment_status = 'paid', payment_source = 'wallet'
     WHERE id = v_reg;
    RETURN jsonb_build_object(
      'status', 'confirmed', 'newlyPaid', true,
      'registrationId', v_reg, 'fee', v_fee,
      'tournamentSlug', v_accept->>'tournamentSlug',
      'tournamentTitle', v_accept->>'tournamentTitle'
    );
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN
    -- The subtransaction rolls back the invitation acceptance and pending row.
    RETURN jsonb_build_object('status', 'insufficient');
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_invitation_payment_attempt(
  p_player uuid, p_invitation uuid, p_reference text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_accept jsonb;
BEGIN
  v_accept := public.accept_invitation_registration(p_player, p_invitation);
  IF v_accept->>'status' <> 'pending' THEN RETURN v_accept; END IF;
  INSERT INTO public.tournament_payment_attempts (registration_id, paystack_reference)
  VALUES ((v_accept->>'registrationId')::uuid, p_reference);
  UPDATE public.tournament_registrations SET paystack_reference = p_reference
   WHERE id = (v_accept->>'registrationId')::uuid;
  RETURN v_accept;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_invitation_paystack(p_reference text, p_amount_kobo integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempt public.tournament_payment_attempts%ROWTYPE;
  v_reg public.tournament_registrations%ROWTYPE;
  v_fee integer;
  v_balance integer;
BEGIN
  SELECT * INTO v_attempt FROM public.tournament_payment_attempts
   WHERE paystack_reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  SELECT * INTO v_reg FROM public.tournament_registrations
   WHERE id = v_attempt.registration_id FOR UPDATE;
  SELECT registration_fee INTO v_fee FROM public.tournaments WHERE id = v_reg.tournament_id;
  IF p_amount_kobo < v_fee * 100 THEN
    RETURN jsonb_build_object('status', 'not_successful');
  END IF;
  IF v_reg.payment_status = 'pending' THEN
    UPDATE public.tournament_registrations
       SET payment_status = 'paid', payment_source = 'paystack', paid_attempt_id = v_attempt.id
     WHERE id = v_reg.id;
    RETURN jsonb_build_object('status', 'confirmed', 'registrationId', v_reg.id, 'playerId', v_reg.player_id);
  END IF;
  IF v_reg.payment_status = 'paid' AND v_reg.paid_attempt_id = v_attempt.id THEN
    RETURN jsonb_build_object('status', 'already_paid');
  END IF;
  IF v_reg.payment_status = 'paid' AND v_attempt.credited_at IS NULL THEN
    v_balance := public.wallet_apply(
      v_reg.player_id, CEIL(p_amount_kobo / 100.0)::integer,
      'registration_overpayment', v_attempt.id,
      'Duplicate tournament payment returned to wallet', 'refund'
    );
    UPDATE public.tournament_payment_attempts SET credited_at = now() WHERE id = v_attempt.id;
    RETURN jsonb_build_object('status', 'overpayment_credited');
  END IF;
  RETURN jsonb_build_object('status', 'already_paid');
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation_registration(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay_invitation_from_wallet(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_invitation_payment_attempt(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_invitation_paystack(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation_registration(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay_invitation_from_wallet(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_invitation_payment_attempt(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_invitation_paystack(text, integer) TO service_role;
NOTIFY pgrst, 'reload schema';
