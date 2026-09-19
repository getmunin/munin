-- Media and link placement for social drafts.
--
-- LinkedIn's Posts API does not scrape URLs, so a bare link in the commentary
-- renders as plain text with no preview card. A picture therefore has to be
-- uploaded as an asset and referenced by the post, which is what media_url
-- feeds: the source we fetch at publish time and hand to the platform's own
-- image or video upload.
--
-- link_placement decides where the link goes. 'body' keeps today's behaviour
-- (appended to the commentary); 'comment' posts it as the first comment
-- instead, which is why comment_external_id and comment_error record what
-- happened to that second call -- the post itself stands either way.
ALTER TABLE "social_post_drafts" ADD COLUMN IF NOT EXISTS "link_placement" varchar(8) DEFAULT 'body' NOT NULL;
ALTER TABLE "social_post_drafts" ADD COLUMN IF NOT EXISTS "link_comment_text" text;
ALTER TABLE "social_post_drafts" ADD COLUMN IF NOT EXISTS "media_url" text;
ALTER TABLE "social_post_drafts" ADD COLUMN IF NOT EXISTS "media_kind" varchar(8);
ALTER TABLE "social_post_drafts" ADD COLUMN IF NOT EXISTS "media_alt_text" text;
ALTER TABLE "social_post_drafts" ADD COLUMN IF NOT EXISTS "comment_external_id" text;
ALTER TABLE "social_post_drafts" ADD COLUMN IF NOT EXISTS "comment_error" text;
