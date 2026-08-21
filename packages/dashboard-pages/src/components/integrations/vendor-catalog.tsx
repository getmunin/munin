import type { ComponentType, SVGProps } from 'react';
import {
  SlackMark,
  ShopifyMark,
  MagentoMark,
  GastroplannerMark,
  CustomMcpMark,
  BingMark,
  GoogleSearchConsoleMark,
} from './integration-vendor-logos';

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
    capabilityKeys: ['bookingsLookup', 'bookingsAvailability', 'bookingsManage'],
    Mark: GastroplannerMark,
  },
  'custom-mcp': {
    categoryKey: 'customTools',
    descriptionKey: 'customMcp',
    capabilityKeys: ['customTools', 'customIdentity'],
    Mark: CustomMcpMark,
  },
  bing: {
    categoryKey: 'seo',
    descriptionKey: 'bing',
    capabilityKeys: ['seoQueries', 'seoIndexStatus', 'seoSubmit'],
    Mark: BingMark,
  },
  google_search_console: {
    categoryKey: 'seo',
    descriptionKey: 'googleSearchConsole',
    capabilityKeys: ['seoQueries', 'seoPages', 'seoIndexStatus'],
    Mark: GoogleSearchConsoleMark,
  },
};

const DOMAIN_CATEGORY: Record<string, string> = {
  commerce: 'commerce',
  bookings: 'booking',
  mcp: 'customTools',
  seo: 'seo',
};

const DOMAIN_CAPABILITIES: Record<string, string[]> = {
  commerce: ['ordersLookup', 'customersLookup'],
  bookings: ['bookingsLookup', 'bookingsAvailability', 'bookingsManage'],
  mcp: ['customTools', 'customIdentity'],
  seo: ['seoQueries', 'seoIndexStatus', 'seoSubmit'],
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
      className="flex flex-none items-center justify-center border-[1px] border-rule-soft bg-paper-deep dark:border-rule-on-dark dark:bg-secondary"
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
