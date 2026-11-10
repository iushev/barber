import Link from "next/link";
import { site } from "@/config/site";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-bone/10 bg-coal border-t">
      <div className="text-bone/60 mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
        <div>
          <p className="font-display text-bone text-lg tracking-[0.2em] uppercase">
            {site.shortName}
            <span className="text-brass">.</span>
          </p>
          <p className="mt-2">{site.tagline}</p>
        </div>
        <address className="not-italic">
          {site.address.street}, {site.address.postalCode} {site.address.city}
          <br />
          <a href={`tel:${site.contact.phoneHref}`} className="hover:text-brass">
            {site.contact.phone}
          </a>
          <br />
          <a href={`mailto:${site.contact.email}`} className="hover:text-brass">
            {site.contact.email}
          </a>
        </address>
        <ul className="space-y-1 sm:text-right">
          <li>
            <Link href="/book" className="hover:text-brass">
              Запази час
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="hover:text-brass">
              Поверителност
            </Link>
          </li>
          {site.social.instagram && (
            <li>
              <a
                href={site.social.instagram}
                rel="noopener noreferrer"
                target="_blank"
                className="hover:text-brass"
              >
                Instagram
              </a>
            </li>
          )}
          {site.social.facebook && (
            <li>
              <a
                href={site.social.facebook}
                rel="noopener noreferrer"
                target="_blank"
                className="hover:text-brass"
              >
                Facebook
              </a>
            </li>
          )}
        </ul>
      </div>
      <p className="text-bone/60 border-bone/10 border-t px-4 py-4 text-center text-xs">
        © {year} {site.legal.controller}
      </p>
    </footer>
  );
}
