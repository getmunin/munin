import type { ComponentType, SVGProps } from 'react';
import { SlackMark, ShopifyMark, MagentoMark, GastroplannerMark } from './integration-vendor-logos';

export interface VendorPresentation {
  categoryKey: string;
  descriptionKey: string;
  capabilityKeys: string[];
  Mark?: ComponentType<SVGProps<SVGSVGElement>>;
}

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
    Mark: MagentoMark,
  },
  gastroplanner: {
    categoryKey: 'booking',
    descriptionKey: 'gastroplanner',
    capabilityKeys: ['bookingsLookup'],
    Mark: GastroplannerMark,
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

export function vendorPresentation(vendor: string, domain?: string): VendorPresentation {
  return (
    VENDOR_PRESENTATION[vendor] ?? {
      categoryKey: (domain && DOMAIN_CATEGORY[domain]) || 'connection',
      descriptionKey: 'generic',
      capabilityKeys: (domain && DOMAIN_CAPABILITIES[domain]) || [],
    }
  );
}

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
