-- Admin reconciliation for money received outside the checkout.
ALTER TABLE public.tournament_registrations
  DROP CONSTRAINT tournament_registrations_payment_source_check;
ALTER TABLE public.tournament_registrations
  ADD CONSTRAINT tournament_registrations_payment_source_check
  CHECK (payment_source IN ('paystack', 'wallet', 'free', 'manual'));

CREATE TABLE public.manual_tournament_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.tournament_registrations(id),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  player_id uuid NOT NULL REFERENCES public.profiles(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  amount integer NOT NULL CHECK (amount > 0),
  channel text NOT NULL CHECK (channel IN ('bank_transfer', 'cash', 'other')),
  reference text NOT NULL CHECK (length(trim(reference)) BETWEEN 4 AND 120),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX manual_tournament_payments_reference_key
  ON public.manual_tournament_payments (channel, lower(reference));
CREATE UNIQUE INDEX manual_tournament_payments_registration_key
  ON public.manual_tournament_payments (registration_id);
ALTER TABLE public.manual_tournament_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_tournament_payments FROM anon, authenticated;

CREATE FUNCTION public.record_manual_invitation_payment(
  p_tournament uuid, p_player uuid, p_actor uuid, p_amount integer,
  p_channel text, p_reference text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_inv public.tournament_invitations%ROWTYPE;
  v_reg public.tournament_registrations%ROWTYPE;
  v_profile record;
  v_held integer;
  v_active integer;
  v_registration_id uuid;
  v_reference text := trim(p_reference);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor AND role = 'admin') THEN
    RETURN jsonb_build_object('status', 'not_admin');
  END IF;
  IF p_channel NOT IN ('bank_transfer', 'cash', 'other') OR
     v_reference IS NULL OR length(v_reference) NOT BETWEEN 4 AND 120 OR
     p_note IS NOT NULL AND length(p_note) > 500 THEN
    RETURN jsonb_build_object('status', 'invalid_reference');
  END IF;

  -- All manual settlements for this tournament serialize before capacity checks.
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND OR v_t.tournament_type NOT IN ('masters', 'champions_cup') THEN
    RETURN jsonb_build_object('status', 'tournament_not_found');
  END IF;
  IF v_t.status <> 'registration_open' THEN
    RETURN jsonb_build_object('status', 'registration_closed');
  END IF;
  IF v_t.registration_fee <= 0 OR p_amount IS DISTINCT FROM v_t.registration_fee THEN
    RETURN jsonb_build_object('status', 'wrong_amount', 'fee', v_t.registration_fee);
  END IF;

  SELECT * INTO v_inv FROM public.tournament_invitations
   WHERE tournament_id = p_tournament AND player_id = p_player FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invitation_not_found'); END IF;
  IF v_inv.status = 'declined' THEN RETURN jsonb_build_object('status', 'invitation_declined'); END IF;

  SELECT id, username, display_name, whatsapp_number, deleted_at INTO v_profile
    FROM public.profiles WHERE id = p_player;
  IF NOT FOUND OR v_profile.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'player_not_found');
  END IF;

  SELECT * INTO v_reg FROM public.tournament_registrations
   WHERE tournament_id = p_tournament AND player_id = p_player FOR UPDATE;
  IF FOUND AND v_reg.payment_status = 'paid' THEN
    RETURN jsonb_build_object('status', 'already_paid');
  END IF;
  IF FOUND AND (v_reg.status <> 'active' OR v_reg.payment_status <> 'pending' OR v_reg.fee_waived) THEN
    RETURN jsonb_build_object('status', 'registration_unavailable');
  END IF;

  IF v_inv.status = 'expired' OR (v_inv.status = 'pending' AND v_inv.expires_at <= now()) THEN
    SELECT count(*) INTO v_held FROM public.tournament_invitations
     WHERE tournament_id = p_tournament AND (status = 'accepted' OR (status = 'pending' AND expires_at > now()));
    IF v_held >= LEAST(16, COALESCE(v_t.max_players, 16)) THEN
      RETURN jsonb_build_object('status', 'no_slot');
    END IF;
  END IF;
  IF v_reg.id IS NULL AND v_t.max_players IS NOT NULL THEN
    SELECT count(*) INTO v_active FROM public.tournament_registrations
     WHERE tournament_id = p_tournament AND status = 'active';
    IF v_active >= v_t.max_players THEN RETURN jsonb_build_object('status', 'no_slot'); END IF;
  END IF;

  UPDATE public.tournament_invitations
     SET status = 'accepted', responded_at = COALESCE(responded_at, now())
   WHERE id = v_inv.id AND status <> 'accepted';

  IF v_reg.id IS NULL THEN
    INSERT INTO public.tournament_registrations (
      tournament_id, player_id, payment_status, payment_source, fee_waived,
      reg_display_name, reg_whatsapp
    ) VALUES (
      p_tournament, p_player, 'paid', 'manual', false,
      COALESCE(v_profile.display_name, v_profile.username), v_profile.whatsapp_number
    ) RETURNING id INTO v_registration_id;
  ELSE
    UPDATE public.tournament_registrations
       SET payment_status = 'paid', payment_source = 'manual', fee_waived = false
     WHERE id = v_reg.id RETURNING id INTO v_registration_id;
  END IF;

  -- A concurrent reuse of the same bank reference raises 23505, rolling back
  -- the invitation and registration changes in this transaction.
  INSERT INTO public.manual_tournament_payments (
    registration_id, tournament_id, player_id, actor_id, amount, channel, reference, note
  ) VALUES (
    v_registration_id, p_tournament, p_player, p_actor, p_amount,
    p_channel, v_reference, NULLIF(trim(p_note), '')
  );
  RETURN jsonb_build_object(
    'status', 'confirmed', 'newlyPaid', true, 'registrationId', v_registration_id,
    'tournamentSlug', v_t.slug, 'tournamentTitle', v_t.title, 'fee', v_t.registration_fee
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_manual_invitation_payment(uuid, uuid, uuid, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_invitation_payment(uuid, uuid, uuid, integer, text, text, text)
  TO service_role;
NOTIFY pgrst, 'reload schema';
