import type { NextConfig } from "next";

const commonSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }
];

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: false
  },
  async redirects() {
    // The GoHighLevel connections page became Connections. Not permanent, and the
    // query string is kept, so the GoHighLevel sign-in return lands with its message.
    return [{ source: "/admin/ghl-connections", destination: "/admin/connections", permanent: false }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: commonSecurityHeaders },
      // Everything except /embed/* refuses to be framed. Embed snippets use
      // /embed/* (iframe) or window.open (popup), so they keep working.
      {
        source: "/((?!embed/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }
        ]
      },
      {
        source: "/embed/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }]
      }
    ];
  }
};

export default nextConfig;
