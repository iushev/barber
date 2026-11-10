import Link from "next/link";
import { site } from "@/config/site";

const NAV = [
  { href: "/#uslugi", label: "Услуги" },
  { href: "/#ekip", label: "Екип" },
  { href: "/#rabotno-vreme", label: "Работно време" },
  { href: "/#kontakti", label: "Контакти" },
];

export function SiteHeader() {
  return (
    <header className="border-bone/10 bg-ink/90 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link
          href="/"
          className="font-display text-bone text-xl tracking-[0.2em] uppercase"
          aria-label={`${site.name} — начало`}
        >
          {site.shortName}
          <span className="text-brass">.</span>
        </Link>
        <nav aria-label="Основна навигация" className="ml-auto hidden md:block">
          <ul className="text-bone/75 flex gap-6 text-sm">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="hover:text-brass transition-colors">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Link
          href="/book"
          className="bg-brass text-ink hover:bg-bone focus-visible:outline-brass ml-auto rounded-sm px-4 py-2 text-sm font-semibold tracking-wide uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:ml-0"
        >
          Запази час
        </Link>
      </div>
      <div className="pole-stripe h-1 opacity-80" aria-hidden="true" />
    </header>
  );
}
