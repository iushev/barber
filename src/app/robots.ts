import type { MetadataRoute } from "next";
import { env } from "@/config/env";

export const dynamic = "force-dynamic"; // PUBLIC_BASE_URL идва от env при стартиране, не при build

export default function robots(): MetadataRoute.Robots {
  const base = env().PUBLIC_BASE_URL.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /booking/<token> са лични линкове; админът и API-тата не са за индексиране.
        disallow: ["/admin", "/api/", "/booking/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
