import type { ComponentType, SVGProps } from 'react';
import { SlackMark, ShopifyMark } from './integration-vendor-logos';

export interface VendorPresentation {
  /** i18n key under integrations.catalog.category for the mono category label. */
  categoryKey: string;
  /** i18n key under integrations.catalog.description for the card blurb. */
  descriptionKey: string;
  /** i18n keys under integrations.catalog.capability for the "what agents get" list. */
  capabilityKeys: string[];
  Mark?: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * Presentation-only metadata (icon, category, blurb, capabilities) for the
 * integrations catalog, keyed by vendor id. The set of *available* vendors is
 * still driven by the backend (`/v1/connectors/vendors` + the Slack module);
 * this map only supplies copy and marks for the ones we know. Unknown vendors
 * fall back to a monogram tile and their displayName.
 */
export const VENDOR_PRESENTATION: Record<string, VendorPresentation> = {
  slack: {
    categoryKey: 'chatBridge',
    descriptionKey: 'slack',
    capabilityKeys: ['slackMirror', 'slackReply'],
    Mark: SlackMark,
  },
  shopify: {
    categoryKey: 'commerce',
    descriptionKey: 'shopify',
    capabilityKeys: ['ordersLookup', 'customersLookup'],
    Mark: ShopifyMark,
  },
  magento: {
    categoryKey: 'commerce',
    descriptionKey: 'magento',
    capabilityKeys: ['ordersLookup', 'customersLookup'],
  },
  gastroplanner: {
    categoryKey: 'booking',
    descriptionKey: 'gastroplanner',
    capabilityKeys: ['bookingsLookup'],
  },
};

const DOMAIN_CATEGORY: Record<string, string> = {
  commerce: 'commerce',
  bookings: 'booking',
};

const DOMAIN_CAPABILITIES: Record<string, string[]> = {
  commerce: ['ordersLookup', 'customersLookup'],
  bookings: ['bookingsLookup'],
};

/** Presentation for a vendor, with a domain-derived fallback for unknown vendors. */
export function vendorPresentation(vendor: string, domain?: string): VendorPresentation {
  return (
    VENDOR_PRESENTATION[vendor] ?? {
      categoryKey: (domain && DOMAIN_CATEGORY[domain]) || 'connection',
      descriptionKey: 'generic',
      capabilityKeys: (domain && DOMAIN_CAPABILITIES[domain]) || [],
    }
  );
}

/** 40×40 (or given size) icon tile: brand mark when known, else a monogram. */
export function VendorIcon({
  vendor,
  label,
  size = 40,
  markSize = 20,
}: {
  vendor: string;
  label: string;
  size?: number;
  markSize?: number;
}) {
  const Mark = VENDOR_PRESENTATION[vendor]?.Mark;
  return (
    <div
      className="flex flex-none items-center justify-center border-[0.5px] border-rule-soft bg-paper-deep dark:border-rule-on-dark dark:bg-secondary"
      style={{ width: size, height: size }}
    >
      {Mark ? (
        <Mark style={{ width: markSize, height: markSize }} />
      ) : (
        <span className="font-serif text-ink dark:text-foreground" style={{ fontSize: markSize * 0.8 }}>
          {label.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}
