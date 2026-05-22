UPDATE "curator_jobs" SET "job_uri" = 'skill://kb/review-content'                 WHERE "job_uri" = 'skill://kb/curation';
UPDATE "curator_jobs" SET "job_uri" = 'skill://crm/clean-contact-data'             WHERE "job_uri" = 'skill://crm/hygiene';
UPDATE "curator_jobs" SET "job_uri" = 'skill://crm/extract-contact-from-message'   WHERE "job_uri" = 'skill://crm/contact-extract';
UPDATE "curator_jobs" SET "job_uri" = 'skill://cms/review-stale-entries'           WHERE "job_uri" = 'skill://cms/stale-content-review';
UPDATE "curator_jobs" SET "job_uri" = 'skill://outreach/draft-initial-email'       WHERE "job_uri" = 'skill://outreach/draft-initial';
UPDATE "curator_jobs" SET "job_uri" = 'skill://outreach/draft-reply-email'         WHERE "job_uri" = 'skill://outreach/draft-reply';
UPDATE "curator_jobs" SET "job_uri" = 'task://web/scrape-website'                  WHERE "job_uri" = 'task://web/scrape-site';
