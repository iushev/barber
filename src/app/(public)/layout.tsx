import type { Metadata } from "next";
import { ChatWidget } from "@/components/chat/chat-widget";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { env } from "@/config/env";
import { site } from "@/config/site";

export async function generateMetadata(): Promise<Metadata> {
  const base = new URL(env().PUBLIC_BASE_URL);
  return {
    metadataBase: base,
    title: { default: `${site.name} — ${site.tagline}`, template: `%s · ${site.name}` },
    description: site.description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: "bg_BG",
      siteName: site.name,
      title: site.name,
      description: site.description,
      url: base,
    },
    twitter: { card: "summary_large_image", title: site.name, description: site.description },
    formatDetection: { telephone: false },
  };
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="focus:bg-brass focus:text-ink sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-3 focus:py-2"
      >
        Към съдържанието
      </a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      <ChatWidget />
    </>
  );
}
