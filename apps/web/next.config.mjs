import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app'],
  transpilePackages: ['@getmunin/dashboard-pages', '@getmunin/sdk', '@getmunin/types', '@getmunin/ui'],
  turbopack: {
    resolveExtensions: ['.mdx', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
    resolveAlias: {
      'tw-animate-css': './node_modules/tw-animate-css/dist/tw-animate.css',
    },
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
