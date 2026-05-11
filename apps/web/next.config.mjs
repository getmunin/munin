import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@getmunin/dashboard-pages', '@getmunin/sdk', '@getmunin/types', '@getmunin/ui'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      (warning) =>
        /next-intl\/dist\/esm\/production\/extractor\/format/.test(String(warning?.message ?? '')),
    ];
    config.infrastructureLogging = {
      ...(config.infrastructureLogging ?? {}),
      level: 'error',
    };
    return config;
  },
};

const sentryDisabled = !process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.SENTRY_DSN;

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  hideSourceMaps: true,
  widenClientFileUpload: true,
  webpack: {
    treeshake: { removeDebugLogging: sentryDisabled },
    reactComponentAnnotation: { enabled: false },
  },
});
