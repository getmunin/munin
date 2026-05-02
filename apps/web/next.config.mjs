import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@getmunin/dashboard-pages', '@getmunin/sdk', '@getmunin/types', '@getmunin/ui'],
};

const sentryDisabled = !process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.SENTRY_DSN;

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  disableLogger: sentryDisabled,
  hideSourceMaps: true,
  widenClientFileUpload: true,
  reactComponentAnnotation: { enabled: false },
});
