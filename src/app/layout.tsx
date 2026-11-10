import { Manrope, Oswald } from "next/font/google";
import "./globals.css";

// Шрифтовете се свалят при build и се сервират от нашия домейн (без заявки към Google).
const display = Oswald({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-display-face",
  display: "swap",
});
const body = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-body",
  display: "swap",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="bg" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
