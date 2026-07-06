-- Populate username + display_name from signup metadata.
-- The username UNIQUE constraint (from 001) still guarantees uniqueness;
-- a collision raises 23505, which the signup server action maps to a
-- friendly "username is taken" message.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (NEW.id,
          NEW.raw_user_meta_data->>'username',
          NEW.raw_user_meta_data->>'username')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
