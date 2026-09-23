import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Avatars from the OAuth providers. Add any other image host you use;
      // a bare "*" does not match every hostname.
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },

  // The template folders are read at runtime by /api/template/[id].
  // Vercel only deploys files it can see being imported, so they are listed here.
  outputFileTracingIncludes: {
    "/api/template/[id]": ["./vibecode-starters/**/*"],
  },
  outputFileTracingExcludes: {
    "/api/template/[id]": [
      "./vibecode-starters/**/node_modules/**",
      "./vibecode-starters/**/.git/**",
      "./vibecode-starters/**/dist/**",
      "./vibecode-starters/**/build/**",
    ],
  },

  async headers() {
    return [
      {
        // Required by WebContainers
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Cross-Origin-Embedder-Policy",
            // "credentialless" still satisfies WebContainers but, unlike
            // "require-corp", lets third-party images (OAuth avatars) load
            value: "credentialless",
          },
        ],
      },
    ];
  },

  reactStrictMode: false,
};

export default nextConfig;
// import type { NextConfig } from "next";

// const nextConfig: NextConfig = {
//   images:{
//     remotePatterns:[
//       {
//         protocol:"https",
//         hostname:"*",
//         port:'',
//         pathname:"/**"
//       }
//     ]
//   },
//   async headers() {
//     return [
//       {
//         // Apply to all routes
//         source: '/:path*',
//         headers: [
//           {
//             key: 'Cross-Origin-Opener-Policy',
//             value: 'same-origin',
//           },
//           {
//             key: 'Cross-Origin-Embedder-Policy',
//             value: 'require-corp',
//           },
//         ],
//       },
//     ];
//   },
//   reactStrictMode:false
// };

// export default nextConfig;
