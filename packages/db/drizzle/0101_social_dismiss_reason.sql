-- Why a reviewer passed on a draft.
--
-- Every other review-queue kind records a reason with its dismissal, and the
-- decided feed renders one column across all of them. Without this, social
-- would be the one kind permanently blank there — not because nobody typed a
-- reason, but because there was nowhere to put it.
--
-- Nullable with no default: a dismissal with no reason stays a dismissal,
-- exactly as it does for kb and crm.

ALTER TABLE "social_post_drafts" ADD COLUMN IF NOT EXISTS "dismiss_reason" text;
