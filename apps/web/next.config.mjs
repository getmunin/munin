/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Workspace packages can be transpiled if needed:
  transpilePackages: ['@munin/sdk', '@munin/types'],
};

export default nextConfig;
