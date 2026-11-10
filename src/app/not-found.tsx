import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { site } from "@/config/site";

export const metadata: Metadata = { title: "Страницата не е намерена", robots: { index: false } };

/**
 * Глобална 404. Динамична (connection()), за да получи CSP nonce като всички страници —
 * статично генерирана страница би била без nonce и скриптовете ѝ биха били блокирани.
 */
export default async function NotFound() {
  await connection();
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-20">
      <p className="font-display text-brass text-sm tracking-[0.3em] uppercase">Грешка 404</p>
      <h1 className="font-display mt-3 text-4xl tracking-wide uppercase">
        Страницата не е намерена
      </h1>
      <p className="text-bone/70 mt-4">
        Адресът е грешен или страницата вече не съществува. Можете да запазите час онлайн или да ни
        се обадите на{" "}
        <a
          href={`tel:${site.contact.phoneHref}`}
          className="text-brass underline underline-offset-4"
        >
          {site.contact.phone}
        </a>
        .
      </p>
      <div className="mt-8 flex flex-wrap gap-6">
        <Link href="/" className="text-brass underline-offset-4 hover:underline">
          ← Начало
        </Link>
        <Link href="/book" className="text-brass underline-offset-4 hover:underline">
          Запази час →
        </Link>
      </div>
    </main>
  );
}
