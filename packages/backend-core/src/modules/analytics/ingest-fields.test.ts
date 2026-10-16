import { describe, it, expect } from 'vitest';
import {
  ANALYTICS_VIEW_SOURCES,
  MAX_INGEST_FIELD_LENGTH,
  MAX_INGEST_METADATA_BYTES,
  analyticsReadDepth,
  analyticsViewSource,
  ingestMetadata,
  truncatedString,
} from './ingest-fields.ts';

describe('truncatedString', () => {
  it('leaves a value inside the limit untouched', () => {
    expect(truncatedString(512).parse('/dashboard/oauth/consent')).toBe(
      '/dashboard/oauth/consent',
    );
  });

  it('truncates instead of rejecting, so an over-long field never drops the event', () => {
    const consentPath = '/en/dashboard/oauth/consent?scope=' + 'a'.repeat(1000);
    const parsed = truncatedString(512).safeParse(consentPath);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(512);
    expect(parsed.data).toBe(consentPath.slice(0, 512));
  });

  it('keeps the pathname intact when only the query string overflows', () => {
    const path = '/en/dashboard/oauth/consent?state=' + 'b'.repeat(900);
    expect(truncatedString(512).parse(path)).toMatch(
      /^\/en\/dashboard\/oauth\/consent\?state=b+$/,
    );
  });

  it('still rejects a field far past any legitimate URL, bounding body size', () => {
    expect(truncatedString(512).safeParse('x'.repeat(MAX_INGEST_FIELD_LENGTH + 1)).success).toBe(
      false,
    );
  });
});

describe('analyticsViewSource', () => {
  it('accepts every source analytics_view_events_source_chk allows', () => {
    for (const source of ANALYTICS_VIEW_SOURCES) {
      expect(analyticsViewSource.safeParse(source).success).toBe(true);
    }
  });

  it('rejects an unknown source at the boundary rather than letting Postgres raise a 500', () => {
    expect(analyticsViewSource.safeParse('web').success).toBe(false);
    expect(analyticsViewSource.safeParse('').success).toBe(false);
  });
});

describe('analyticsReadDepth', () => {
  it('accepts the whole percentage range analytics_view_events_read_depth_chk allows', () => {
    expect(analyticsReadDepth.safeParse(0).success).toBe(true);
    expect(analyticsReadDepth.safeParse(100).success).toBe(true);
  });

  it('rejects a depth outside 0-100 rather than letting Postgres raise a 500', () => {
    expect(analyticsReadDepth.safeParse(-1).success).toBe(false);
    expect(analyticsReadDepth.safeParse(101).success).toBe(false);
  });
});

describe('ingestMetadata', () => {
  it('keeps metadata that fits in the cap', () => {
    expect(ingestMetadata().parse({ plan: 'pro', amount: 49 })).toEqual({ plan: 'pro', amount: 49 });
  });

  it('drops oversized metadata instead of the event, so a public key cannot store megabytes per view', () => {
    const big = { blob: 'x'.repeat(MAX_INGEST_METADATA_BYTES) };
    const parsed = ingestMetadata().safeParse(big);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeNull();
  });

  it('measures the serialized size in bytes, not characters', () => {
    const chars = MAX_INGEST_METADATA_BYTES / 2;
    expect(ingestMetadata().parse({ v: 'æ'.repeat(chars) })).toBeNull();
  });
});
