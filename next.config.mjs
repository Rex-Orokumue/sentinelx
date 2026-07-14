/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@base-ui/react', 'tailwind-merge'],
  // Every admin (and dashboard) page is dynamically rendered because it reads
  // the session cookie — but Next 14.2's Client Router Cache still holds a
  // stale copy for 30s after a soft navigation by default. This app deals in
  // live operational data (pending withdrawals, disputes, notifications), so
  // dynamic routes must always be refetched on navigation instead.
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },
}

export default nextConfig;
