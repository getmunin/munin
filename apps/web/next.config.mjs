/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Workspace packages can be transpiled if needed:
  transpilePackages: ['@munin/dashboard-pages', '@munin/sdk', '@munin/types', '@munin/ui'],
};

export default nextConfig;
