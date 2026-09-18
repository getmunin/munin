-- The suggested author was advisory only: publishing has always used the
-- connected account of whoever clicks publish, never this column. Naming a
-- person the surface then had to disclaim was worse than naming nobody, so the
-- routing hint is dropped in favour of the variant label, which already names
-- the angle a variant takes and already tags its share link.
ALTER TABLE social_post_drafts DROP COLUMN IF EXISTS suggested_user_id;
