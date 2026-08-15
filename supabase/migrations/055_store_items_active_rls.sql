-- 055_store_items_active_rls.sql
-- Restrict store_items read access to active items for anon/authenticated
-- clients; staff (via is_staff()) can still see inactive items directly,
-- matching what /admin/store already relies on via the service-role client
-- (service-role bypasses RLS entirely regardless, so this only tightens
-- what the anon/authenticated roles can see). Previously "store_items_read"
-- (052_sx_coins_store.sql) was USING (true) unconditionally, meaning an
-- unreleased/inactive item's name, price, and description were readable by
-- anyone with the anon key, directly via the REST API.
DROP POLICY IF EXISTS "store_items_read" ON public.store_items;
CREATE POLICY "store_items_read" ON public.store_items
  FOR SELECT USING (active = true OR public.is_staff());
