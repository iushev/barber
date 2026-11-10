import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Админ панел", template: "%s · Админ" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-ink text-bone min-h-dvh">{children}</div>;
}
