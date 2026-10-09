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
    // KEPT ON DELIBERATELY — read before flipping.
    //
    // With this true, every <Image> renders its src unchanged: no resizing, no
    // format conversion, no srcset. Turning it off is a genuine bandwidth/LCP
    // win for the TMDB posters, BUT the optimizer fetches the source image
    // server-side and Next deliberately forwards NO request headers when it
    // does (see the `unoptimized` section of the next/image docs). Several of
    // this app's provider episode thumbnails are hotlink-protected and need a
    // Referer, so those would start failing through the optimizer.
    //
    // So: flip to `false` only after checking watch-page episode thumbnails.
    // remotePatterns below is already populated for that day.
    //
    // While it stays true, the wins that still apply are lazy loading,
    // layout-shift prevention from explicit sizing, and `priority`-driven
    // preloading — which is what actually moves the hero image's LCP.
    unoptimized: true,

    // Only consulted when optimization is on, but declared up front so that
    // flipping the flag above doesn't instantly break every poster.
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "placehold.co" },
      { protocol: "https", hostname: "s4.anilist.co" },
      { protocol: "https", hostname: "**.supabase.co" }, // profile avatars
      // The companion anime API serves some artwork directly, and it is
      // reached over plain HTTP on localhost / the LAN.
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "http", hostname: "192.168.86.75" },
      { protocol: "http", hostname: "192.168.86.75" },
    ],
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
