const nextConfig = {
  transpilePackages: ["mapbox-gl"],
  // Webpack's persistent on-disk dev cache (.next/cache/webpack) can get its
  // chunk-ID manifest out of sync with what's actually on disk when edits
  // land in quick succession, producing "Cannot find module './NNN.js'"
  // crashes that only a full `.next` wipe fixes. Disabling the cache in dev
  // trades a little rebuild speed for not corrupting itself.
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "dl.airtable.com",
      },
      {
        protocol: "https",
        hostname: "v5.airtableusercontent.com",
      },
      {
        protocol: "https",
        hostname: "**.airtableusercontent.com",
      },
    ],
  },
};

export default nextConfig;
