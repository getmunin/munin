/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@getmunin/dashboard-pages', '@getmunin/sdk', '@getmunin/types', '@getmunin/ui'],
};

export default nextConfig;
