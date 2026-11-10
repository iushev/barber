import Image from "next/image";
import Link from "next/link";
import { LocalBusinessJsonLd } from "@/components/site/json-ld";
import { MapEmbed } from "@/components/site/map-embed";
import { PhotoPlaceholder } from "@/components/site/photo-placeholder";
import { env } from "@/config/env";
import { site } from "@/config/site";
import { formatPrice, WEEKDAY_LABELS } from "@/lib/format";
import { bookingService } from "@/server/booking";

// Данните (услуги, екип, работно време) се менят от админ панела → рендер при заявка.
export const dynamic = "force-dynamic";

function SectionTitle({
  index,
  id,
  children,
}: {
  index: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-10 flex items-baseline gap-4">
      <span className="font-display text-brass text-sm tracking-[0.3em]" aria-hidden="true">
        {index}
      </span>
      <h2 id={id} className="font-display text-3xl tracking-wide uppercase sm:text-4xl">
        {children}
      </h2>
      <span className="bg-bone/15 h-px flex-1" aria-hidden="true" />
    </div>
  );
}

export default async function HomePage() {
  const svc = bookingService();
  const { CURRENCY, PUBLIC_BASE_URL } = env();
  const [services, barbers, hours] = await Promise.all([
    svc.listActiveServices(),
    svc.listActiveBarbers(),
    svc.getShopHours(),
  ]);
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${site.address.geo.lat},${site.address.geo.lng}`;

  return (
    <>
      <LocalBusinessJsonLd
        baseUrl={PUBLIC_BASE_URL.replace(/\/$/, "")}
        services={services}
        hours={hours}
        currency={CURRENCY}
      />

      {/* ---------------- Херо ---------------- */}
      <section aria-labelledby="hero-title" className="grain relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:py-24 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="text-brass mb-6 text-xs font-semibold tracking-[0.35em] uppercase">
              Бръснарница · {site.address.city}
            </p>
            <h1
              id="hero-title"
              className="font-display text-[clamp(3.5rem,11vw,8rem)] leading-[0.9] font-medium tracking-tight uppercase"
            >
              {site.shortName}
              <span className="text-brass">.</span>
            </h1>
            <p className="text-bone/80 mt-6 max-w-md text-lg sm:text-xl">{site.tagline}</p>
            <p className="text-bone/60 mt-3 max-w-md">{site.description}</p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href="/book"
                className="bg-brass text-ink hover:bg-bone focus-visible:outline-brass rounded-sm px-7 py-4 text-base font-semibold tracking-wider uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Запази час
              </Link>
              <a
                href="#uslugi"
                className="border-bone/30 hover:border-brass hover:text-brass rounded-sm border px-7 py-4 text-base font-semibold tracking-wider uppercase transition-colors"
              >
                Услуги и цени
              </a>
            </div>
          </div>
          <PhotoPlaceholder
            label="интериор или работа на стола (4:5)"
            className="aspect-[4/5] w-full"
          />
        </div>
      </section>

      {/* ---------------- За нас ---------------- */}
      <section aria-labelledby="za-nas" className="border-bone/10 border-t">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <SectionTitle index="01" id="za-nas">
            {site.about.title}
          </SectionTitle>
          <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
            <div className="text-bone/75 space-y-5 text-lg leading-relaxed">
              {site.about.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <dl className="grid grid-cols-3 gap-4 lg:grid-cols-1">
              {site.about.highlights.map((h) => (
                <div key={h.label} className="border-brass/40 flex flex-col border-l-2 pl-4">
                  <dt className="text-bone/60 text-sm">{h.label}</dt>
                  <dd className="font-display text-brass order-first text-4xl">{h.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ---------------- Услуги ---------------- */}
      <section aria-labelledby="uslugi-title" id="uslugi" className="bg-coal scroll-mt-20">
        <div className="mx-auto max-w-4xl px-4 py-20">
          <SectionTitle index="02" id="uslugi-title">
            Услуги и цени
          </SectionTitle>
          {services.length === 0 ? (
            <p className="text-bone/60">Скоро ще публикуваме услугите.</p>
          ) : (
            <ul className="space-y-8">
              {services.map((s) => (
                <li key={s.id}>
                  <div className="flex items-baseline gap-3">
                    <h3 className="font-display text-xl tracking-wide uppercase">{s.name}</h3>
                    <span className="leader" aria-hidden="true" />
                    <span className="font-display text-brass text-xl whitespace-nowrap">
                      {formatPrice(s.priceCents, CURRENCY)}
                    </span>
                  </div>
                  <div className="text-bone/60 mt-1 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
                    <p className="max-w-xl">
                      {s.description}
                      {s.description && " · "}
                      <span className="whitespace-nowrap">{s.durationMin} мин</span>
                    </p>
                    {s.barbers.length > 0 && (
                      <Link
                        href={`/book?service=${s.id}`}
                        className="text-brass hover:text-bone text-xs font-semibold tracking-wider uppercase"
                        aria-label={`Запази час за ${s.name}`}
                      >
                        Запази →
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---------------- Екип ---------------- */}
      <section aria-labelledby="ekip-title" id="ekip" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <SectionTitle index="03" id="ekip-title">
            Екипът
          </SectionTitle>
          <ul className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            {barbers.map((b) => (
              <li key={b.id} className="group">
                {b.photoPath ? (
                  <Image
                    src={`/uploads/${b.photoPath}`}
                    alt={`${b.name}, бръснар`}
                    width={480}
                    height={600}
                    unoptimized
                    className="aspect-[4/5] w-full rounded-sm object-cover grayscale transition duration-500 group-hover:grayscale-0"
                  />
                ) : (
                  <PhotoPlaceholder
                    label={`портрет на ${b.name}`}
                    className="aspect-[4/5] w-full"
                  />
                )}
                <h3 className="font-display mt-5 text-2xl tracking-wide uppercase">{b.name}</h3>
                {b.bio && <p className="text-bone/70 mt-2">{b.bio}</p>}
                {b.services.length > 0 && (
                  <p className="text-bone/60 mt-3 text-sm">{b.services.join(" · ")}</p>
                )}
                <Link
                  href={`/book?barber=${b.id}`}
                  className="text-brass hover:text-bone mt-4 inline-block text-sm font-semibold tracking-wider uppercase"
                  aria-label={`Запази час при ${b.name}`}
                >
                  Запази час при {b.name.split(" ")[0]} <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------- Работно време и адрес ---------------- */}
      <section aria-labelledby="vreme-title" id="rabotno-vreme" className="bg-coal scroll-mt-20">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 lg:grid-cols-2">
          <div>
            <SectionTitle index="04" id="vreme-title">
              Работно време
            </SectionTitle>
            <table className="w-full text-left">
              <caption className="sr-only">Работно време по дни</caption>
              <tbody>
                {hours.map((h, i) => (
                  <tr key={i} className="border-bone/10 border-b last:border-0">
                    <th scope="row" className="py-3 font-normal">
                      {WEEKDAY_LABELS[i]}
                    </th>
                    <td className={`py-3 text-right tabular-nums ${h ? "" : "text-bone/60"}`}>
                      {h ? `${h.open} – ${h.close}` : "почивен ден"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-bone/60 mt-4 text-sm">
              Свободните часове на всеки бръснар виждате при записване.
            </p>
          </div>
          <div>
            <h3 className="font-display mb-4 text-2xl tracking-wide uppercase">Адрес</h3>
            <address className="text-bone/80 text-lg not-italic">
              {site.address.street}
              <br />
              {site.address.postalCode} {site.address.city}
            </address>
            <p className="text-bone/60 mt-2">{site.address.directions}</p>
            <a
              href={mapsHref}
              rel="noopener noreferrer"
              target="_blank"
              className="text-brass hover:text-bone mt-4 inline-block text-sm font-semibold tracking-wider uppercase"
            >
              Упътване в Google Maps ↗
            </a>
          </div>
        </div>
      </section>

      {/* ---------------- Контакти ---------------- */}
      <section aria-labelledby="kontakti-title" id="kontakti" className="scroll-mt-20">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 lg:grid-cols-2">
          <div>
            <SectionTitle index="05" id="kontakti-title">
              Контакти
            </SectionTitle>
            <dl className="space-y-6 text-lg">
              <div>
                <dt className="text-bone/60 text-sm tracking-widest uppercase">Телефон</dt>
                <dd>
                  <a href={`tel:${site.contact.phoneHref}`} className="hover:text-brass">
                    {site.contact.phone}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-bone/60 text-sm tracking-widest uppercase">Имейл</dt>
                <dd>
                  <a href={`mailto:${site.contact.email}`} className="hover:text-brass">
                    {site.contact.email}
                  </a>
                </dd>
              </div>
            </dl>
            <Link
              href="/book"
              className="bg-brass text-ink hover:bg-bone mt-10 inline-block rounded-sm px-7 py-4 font-semibold tracking-wider uppercase transition-colors"
            >
              Запази час онлайн
            </Link>
          </div>
          <MapEmbed
            lat={site.address.geo.lat}
            lng={site.address.geo.lng}
            label={site.address.street}
          />
        </div>
      </section>
    </>
  );
}
