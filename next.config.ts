import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keeps your custom dev origin permissions intact
  allowedDevOrigins: ['192.168.86.75'],

  // NOTE: `output: 'export'` was removed because it is incompatible with this app:
  //   - Dynamic routes (/anime/[id]) require generateStaticParams() with static export
  //   - API routes (/api/site-banner, /api/stream-proxy, /api/admin/*) are disabled
  //   - The Electron dock app already runs `next start` (production server mode)
  trailingSlash: false,   // Stops Electron from breaking on "index.html/" folder routing paths
  images: {
    unoptimized: true,    // Disables server-side image scaling so images load offline locally
  },

  // The watch page is fully dynamic (episode list, stream resolve, resume
  // times). Safari caches page HTML aggressively, so after a dev-server restart
  // an iPad can re-serve stale HTML that references old hashed JS chunks — those
  // 404 and the page fails to hydrate, leaving the episode list/name/player
  // blank (works on Chrome because it revalidates). Never cache it.
  async headers() {
    return [
      {
        source: "/watch/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
