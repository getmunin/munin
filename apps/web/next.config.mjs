/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Workspace packages can be transpiled if needed:
  transpilePackages: ['@getmunin/dashboard-pages', '@getmunin/sdk', '@getmunin/types', '@getmunin/ui'],
};

export default nextConfig;
