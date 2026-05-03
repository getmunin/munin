import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const SETTINGS_REDIRECTS = [
  'team',
  'api-keys',
  'agents',
  'end-users',
  'usage',
  'audit-log',
  'export',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@getmunin/dashboard-pages', '@getmunin/sdk', '@getmunin/types', '@getmunin/ui'],
  async redirects() {
    return SETTINGS_REDIRECTS.map((slug) => ({
      source: `/dashboard/${slug}`,
      destination: `/dashboard/settings/${slug}`,
      permanent: true,
    }));
  },
};

const sentryDisabled = !process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.SENTRY_DSN;

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  disableLogger: sentryDisabled,
  hideSourceMaps: true,
  widenClientFileUpload: true,
  reactComponentAnnotation: { enabled: false },
});
