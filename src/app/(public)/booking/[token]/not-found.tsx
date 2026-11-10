import Link from "next/link";
import { site } from "@/config/site";

export default function BookingNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20">
      <h1 className="font-display text-3xl tracking-wide uppercase">Резервацията не е намерена</h1>
      <p className="text-bone/70 mt-4">
        Линкът е невалиден или непълен. Проверете дали сте го копирали изцяло, или ни се обадете на{" "}
        <a
          href={`tel:${site.contact.phoneHref}`}
          className="text-brass underline underline-offset-4"
        >
          {site.contact.phone}
        </a>
        .
      </p>
      <Link href="/book" className="text-brass mt-8 inline-block">
        Запази нов час →
      </Link>
    </div>
  );
}
