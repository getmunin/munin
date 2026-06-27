import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { AnalyticsService } from './analytics.service.ts';
import { CursorInputSchema, IdMapSchema } from '../../common/transfer/transfer.types.ts';

const AnalyticsImportInput = z.object({
  config: z
    .object({
      trackers: z.array(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(120),
          allowedOrigins: z.array(z.string()).default([]),
          requireVerifiedIdentity: z.boolean().default(false),
          identityVerificationSecret: z.string().nullable().optional(),
        }),
      ),
      visitorIdentities: z.array(
        z.object({
          id: z.string(),
          visitorId: z.string().min(1).max(64),
          endUserId: z.string(),
        }),
      ),
    })
    .optional(),
  events: z
    .object({
      viewEvents: z.array(
        z.object({
          id: z.string(),
          subjectType: z.string().max(32),
          subjectId: z.string(),
          source: z.string().max(8),
          path: z.string().nullable().optional(),
          locale: z.string().nullable().optional(),
          referrer: z.string().nullable().optional(),
          utmSource: z.string().nullable().optional(),
          utmMedium: z.string().nullable().optional(),
          utmCampaign: z.string().nullable().optional(),
          visitorId: z.string().nullable().optional(),
          endUserId: z.string().nullable().optional(),
          userAgentClass: z.string().nullable().optional(),
          dwellMs: z.number().int().nullable().optional(),
          readDepth: z.number().int().nullable().optional(),
          country: z.string().nullable().optional(),
          metadata: z.record(z.string(), z.unknown()).nullable().optional(),
          createdAt: z.string(),
        }),
      ),
      searchEvents: z.array(
        z.object({
          id: z.string(),
          subjectType: z.string().max(32),
          query: z.string(),
          locale: z.string().nullable().optional(),
          resultCount: z.number().int(),
          visitorId: z.string().nullable().optional(),
          endUserId: z.string().nullable().optional(),
          createdAt: z.string(),
        }),
      ),
    })
    .optional(),
  idMap: IdMapSchema.optional(),
});

const EmptyInput = z.object({});

const ViewSourceSchema = z.enum(['pixel', 'beacon', 'tracker']);

const CreateTrackerInput = z.object({
  name: z.string().min(1).max(120),
  allowedOrigins: z.array(z.string().url()).optional(),
  requireVerifiedIdentity: z.boolean().optional(),
});

const UpdateTrackerInput = z.object({
  trackerId: z.string(),
  name: z.string().min(1).max(120).optional(),
  allowedOrigins: z.array(z.string().url()).optional(),
  requireVerifiedIdentity: z.boolean().optional(),
});

const RevokeTrackerInput = z.object({
  trackerId: z.string(),
});

const RotateIdentitySecretInput = z.object({
  trackerId: z.string(),
});

const RotateTrackerKeyInput = z.object({
  trackerId: z.string(),
});

const ListTrackersInput = z.object({
  includeRevoked: z.boolean().optional(),
});

const TopSubjectsInput = z.object({
  subjectType: z.string().max(32).optional(),
  sinceDays: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(200).default(20),
  source: ViewSourceSchema.optional(),
  endUserId: z.string().optional(),
  contactId: z.string().optional(),
});

const TopCountriesInput = z.object({
  subjectType: z.string().max(32).optional(),
  sinceDays: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(200).default(50),
  source: ViewSourceSchema.optional(),
});

const TrafficBySourceInput = z.object({
  subjectType: z.string().max(32).optional(),
  sinceDays: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(200).default(50),
  source: ViewSourceSchema.optional(),
});

const ReferrerHostsInput = z.object({
  subjectType: z.string().max(32).optional(),
  excludeHost: z.string().max(255).optional(),
  sinceDays: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(200).default(50),
  source: ViewSourceSchema.optional(),
});

const ViewsOverTimeInput = z.object({
  subjectType: z.string().max(32).optional(),
  subjectId: z.string().optional(),
  sinceDays: z.number().int().min(1).max(365).default(30),
  source: ViewSourceSchema.optional(),
  endUserId: z.string().optional(),
  contactId: z.string().optional(),
});

const SubjectEngagementInput = z.object({
  subjectType: z.string().max(32),
  subjectId: z.string(),
  sinceDays: z.number().int().min(1).max(365).default(90),
  endUserId: z.string().optional(),
  contactId: z.string().optional(),
});

const ZeroResultSearchesInput = z.object({
  subjectType: z.string().max(32).optional(),
  sinceDays: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(200).default(50),
});

const ContactJourneyInput = z.object({
  contactId: z.string().optional(),
  endUserId: z.string().optional(),
  sinceDays: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(500).default(100),
});

const FunnelStepSchema = z
  .object({
    label: z.string().max(120).optional(),
    subjectType: z.string().max(32).optional(),
    subjectId: z.string().max(512).optional(),
    pathLike: z.string().max(512).optional(),
  })
  .refine((s) => Boolean(s.subjectType || s.subjectId || s.pathLike), {
    message: 'each funnel step needs at least one of subjectType, subjectId, or pathLike',
  });

const FunnelInput = z.object({
  steps: z.array(FunnelStepSchema).min(2).max(8),
  sinceDays: z.number().int().min(1).max(365).default(30),
  stepWindowHours: z.number().int().min(1).max(24 * 365).optional(),
  source: ViewSourceSchema.optional(),
});

@Injectable()
export class AnalyticsAdminTools {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @McpTool({
    name: 'analytics_export_config',
    title: 'Analytics: Export trackers + visitor identities',
    description:
      'Export this org\'s analytics configuration — trackers and visitor-identity links — as a portable JSON payload. Low-volume, returned in one shot. Tracker identity-verification secrets are redacted (the ciphertext is useless on another server); the operator re-enters them after import. Pair with `analytics_export_events` (paginated) and feed both into `analytics_import` on another Munin server.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  exportConfig() {
    return this.analytics.exportAnalyticsConfig();
  }

  @McpTool({
    name: 'analytics_export_events',
    title: 'Analytics: Export view + search events (paginated)',
    description:
      'Export this org\'s analytics events (page-view and search events) as a portable JSON payload. High-volume, so this is keyset-paginated over (createdAt, id): call with no arguments for the first page, then pass the returned `nextCursor` back as `cursor` until it comes back `null`. `limit` defaults to 200 (max 500). Feed each page\'s `records` into `analytics_import`. Import trackers + visitor identities first via `analytics_export_config` so event foreign keys resolve.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: CursorInputSchema,
    readOnlyHint: true,
    destructiveHint: false,
  })
  exportEvents(args: z.infer<typeof CursorInputSchema>) {
    return this.analytics.exportAnalyticsEvents(args);
  }

  @McpTool({
    name: 'analytics_import',
    title: 'Analytics: Import data',
    description:
      'Import analytics `config` (trackers + visitor identities) and/or `events` (view + search events) produced by `analytics_export_config` / `analytics_export_events`, typically from another Munin server. Trackers are upserted by (org, name); visitor identities by (org, visitorId). Trackers import without their redacted identity-verification secret — rotate it afterwards. Visitor identities and events resolve their end-user / tracker foreign keys through `idMap`, so import end-users first and pass that `idMap` back in here. Events have no natural key: they are de-duplicated only within one run via `idMap` (re-running without the prior `idMap` inserts duplicates). Returns counts, warnings, and the merged `idMap` (source id → id on this server) — pass it forward to later imports.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: AnalyticsImportInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  importAnalytics(args: z.infer<typeof AnalyticsImportInput>) {
    return this.analytics.importAnalytics(
      { config: args.config, events: args.events },
      args.idMap,
    );
  }

  @McpTool({
    name: 'analytics_create_tracker',
    title: 'Analytics: Create tracker key',
    description:
      'Create a tracker and mint a public `mn_track_*` API key bound to it. The key is safe to embed in `<script>` tags or mobile clients — it can only write page-view events scoped to your org, never read them. `allowedOrigins` is an optional list of full origins (`https://example.com`) the tracker will accept; when empty, any origin is accepted (set `MUNIN_TRACKER_REQUIRE_ALLOWLIST=1` to fail-closed instead). Returns the plaintext key once; store it where it needs to be embedded. Scaffolding a frontend from Lovable/Bolt/v0/Replit/Cursor? Read `skill://playbooks/frontend-integration` first — it covers the tracker + widget + CMS wiring end-to-end.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: CreateTrackerInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createTracker(args: z.infer<typeof CreateTrackerInput>) {
    return this.analytics.createTracker(args);
  }

  @McpTool({
    name: 'analytics_list_trackers',
    title: 'Analytics: List tracker keys',
    description:
      'List analytics trackers for the current org with their key prefix, allowed origins, and revocation state. Plaintext keys are never returned; rotate via `analytics_revoke_tracker` + `analytics_create_tracker`.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: ListTrackersInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listTrackers(args: z.infer<typeof ListTrackersInput>) {
    return this.analytics.listTrackers(args);
  }

  @McpTool({
    name: 'analytics_update_tracker',
    title: 'Analytics: Update tracker config',
    description:
      'Update a tracker\'s display name and/or `allowedOrigins`. The bound API key is unchanged — rotate via `analytics_revoke_tracker` + `analytics_create_tracker`.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: UpdateTrackerInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateTracker(args: z.infer<typeof UpdateTrackerInput>) {
    return this.analytics.updateTracker(args);
  }

  @McpTool({
    name: 'analytics_rotate_tracker_identity_secret',
    title: 'Analytics: Rotate tracker identity verification secret',
    description:
      "Mint a fresh HMAC secret for verifying visitor-identity claims sent to `/v1/a/identify`. Returns the plaintext secret once; store it server-side and use it to compute `userHash = HMAC_SHA256(externalId, secret)` before calling `window.mn.identify(externalId, userHash)` from the browser. The previous secret is replaced immediately — any in-flight identify calls signed with it will fail.",
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: RotateIdentitySecretInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  rotateIdentitySecret(args: z.infer<typeof RotateIdentitySecretInput>) {
    return this.analytics.rotateIdentitySecret(args);
  }

  @McpTool({
    name: 'analytics_rotate_tracker_key',
    title: 'Analytics: Rotate tracker key',
    description:
      'Revoke any active `mn_track_*` keys bound to this tracker and mint a fresh one. Returns the new plaintext key once; update any page that embeds the old key. Pages still embedding the old key will silently stop recording views once revocation lands.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: RotateTrackerKeyInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  rotateTrackerKey(args: z.infer<typeof RotateTrackerKeyInput>) {
    return this.analytics.rotateTrackerKey(args);
  }

  @McpTool({
    name: 'analytics_list_top_subjects',
    title: 'Analytics: Top subjects by view count',
    description:
      'List the most-viewed subjects (CMS entries, landing pages, etc.) over a recent window. Use this to see what content is actually getting traffic. Filter by `subjectType` to scope to one surface (e.g. `cms_entry`). Pass `endUserId` or `contactId` to restrict the ranking to one identified visitor — useful for "what has this lead been reading?".',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: TopSubjectsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  topSubjects(args: z.infer<typeof TopSubjectsInput>) {
    return this.analytics.topSubjects(args);
  }

  @McpTool({
    name: 'analytics_list_top_countries',
    title: 'Analytics: Visitors by country',
    description:
      'Visitor and view counts grouped by ISO 3166-1 alpha-2 country code over a recent window. Requires the backend to have `MUNIN_GEOIP_DB_PATH` configured; rows recorded without a GeoIP DB carry `country = NULL` and roll up into an "unknown" bucket. Filter by `subjectType` (e.g. `page`, `cms_entry`) or `source` to scope.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: TopCountriesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  topCountries(args: z.infer<typeof TopCountriesInput>) {
    return this.analytics.topCountries(args);
  }

  @McpTool({
    name: 'analytics_get_traffic_by_source',
    title: 'Analytics: Traffic by UTM source',
    description:
      'Views and unique visitors grouped by `utm_source` (with `utm_medium` / `utm_campaign` breakdown). Use this to compare campaign attribution: which channels actually drive engaged traffic vs. just clicks. Rows where `utm_source` is NULL (no campaign params on the URL) roll into a single "direct/organic" bucket.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: TrafficBySourceInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  trafficBySource(args: z.infer<typeof TrafficBySourceInput>) {
    return this.analytics.trafficBySource(args);
  }

  @McpTool({
    name: 'analytics_list_referrer_hosts',
    title: 'Analytics: Top referrer hosts',
    description:
      'External traffic sources grouped by the host portion of `referrer`. Use this to see which sites are linking to you (HN, Reddit, partner blogs). Same-origin referrers are excluded server-side via the `excludeHost` argument (typically your own production host); pass it to keep internal navigations from drowning out external referrals. Rows with NULL referrer (direct navigation, bookmarks, link-with-`rel=noreferrer`) roll into a single "direct" bucket.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: ReferrerHostsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  referrerHosts(args: z.infer<typeof ReferrerHostsInput>) {
    return this.analytics.referrerHosts(args);
  }

  @McpTool({
    name: 'analytics_get_views_over_time',
    title: 'Analytics: Daily view time-series',
    description:
      'Daily view + unique-visitor counts over a recent window. Returns one row per UTC day, ordered oldest → newest, with zero-filled gaps so days with no traffic appear as `views: 0`. Use this to spot trends, weekly patterns, and the impact of campaigns or content launches.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: ViewsOverTimeInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  viewsOverTime(args: z.infer<typeof ViewsOverTimeInput>) {
    return this.analytics.viewsOverTime(args);
  }

  @McpTool({
    name: 'analytics_get_subject_engagement',
    title: 'Analytics: Engagement for one subject',
    description:
      'View counts, unique visitors, and average dwell/read-depth for one subject (e.g. one CMS entry) over a recent window. Use this when judging whether a stale entry should be refreshed or archived.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: SubjectEngagementInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  subjectEngagement(args: z.infer<typeof SubjectEngagementInput>) {
    return this.analytics.subjectEngagement(args);
  }

  @McpTool({
    name: 'analytics_get_funnel',
    title: 'Analytics: Conversion funnel across ordered steps',
    description:
      'Compute a conversion funnel over page-view events: how many distinct visitors reached each ordered step, and where they drop off. Pass 2–8 `steps`; each step matches a view event by `subjectType` and/or `subjectId` (e.g. `{ subjectType: "page", subjectId: "/pricing" }`) and/or a `pathLike` SQL LIKE pattern (e.g. `{ pathLike: "/blog/%" }`). Steps are strictly ordered — a visitor counts at step N only if they hit step N after reaching step N-1. Visitors are grouped by a stable actor key (their identified end-user when known, else their anonymous `visitor_id`), so a journey that spans the anonymous → identified transition is not double-counted. Set `stepWindowHours` to require each step to follow the previous within a time budget (e.g. signup within 24h of viewing pricing). Anonymous funnels work without any identity setup. Returns per-step actor counts plus conversion/drop rates.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: FunnelInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  funnel(args: z.infer<typeof FunnelInput>) {
    return this.analytics.funnel(args);
  }

  @McpTool({
    name: 'analytics_get_contact_journey',
    title: 'Analytics: Journey of subjects viewed by a contact',
    description:
      'Chronological list of page-view and search events recorded for one identified visitor. Pass either `contactId` (resolved through `crm_contacts.endUserId`) or `endUserId` directly. Returns the ordered event timeline — what the lead looked at before they reached out, what they searched for, etc. Visitors are linked to an end-user identity by the chat-widget on first chat, or via `window.mn.identify(externalId, userHash)`. Events recorded under a `visitor_id` *before* that link was established are still included retroactively — the link is resolved at read time — so the journey spans the visitor\'s anonymous history too.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: ContactJourneyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  contactJourney(args: z.infer<typeof ContactJourneyInput>) {
    return this.analytics.contactJourney(args);
  }

  @McpTool({
    name: 'analytics_list_zero_result_searches',
    title: 'Analytics: Zero-result search queries',
    description:
      'List recent public search queries that returned zero results. The single best input for "what should we write about next" — readers are asking but Munin has no answer.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: ZeroResultSearchesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  zeroResultSearches(args: z.infer<typeof ZeroResultSearchesInput>) {
    return this.analytics.zeroResultSearches(args);
  }

  @McpTool({
    name: 'analytics_revoke_tracker',
    title: 'Analytics: Revoke tracker key',
    description:
      'Revoke the API key bound to a tracker. After this, the key is rejected by the ingest endpoints — any pages still embedding it will silently fail to record views. The tracker row stays for audit.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: RevokeTrackerInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  revokeTracker(args: z.infer<typeof RevokeTrackerInput>) {
    return this.analytics.revokeTracker(args);
  }
}
