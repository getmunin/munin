DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE "oauth_refresh_token" AS rt
  SET "reference_id" = om."org_id"
  FROM "org_members" om
  WHERE rt."reference_id" IS NULL
    AND om."user_id" = rt."user_id"
    AND om."is_default" = true;

  UPDATE "oauth_access_token" AS act
  SET "reference_id" = om."org_id"
  FROM "org_members" om
  WHERE act."reference_id" IS NULL
    AND om."user_id" = act."user_id"
    AND om."is_default" = true;
END $$;
