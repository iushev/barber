import type { Metadata } from "next";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { env } from "@/config/env";
import { site } from "@/config/site";
import { bookingService } from "@/server/booking";

export const metadata: Metadata = {
  title: "Запази час",
  description: `Запазете час онлайн в ${site.name}: изберете услуга, бръснар, дата и свободен час.`,
  alternates: { canonical: "/book" },
};
export const dynamic = "force-dynamic";

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const svc = bookingService();
  const [services, barbers] = await Promise.all([
    svc.listActiveServices(),
    svc.listActiveBarbers(),
  ]);
  return (
    <div className="grain">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <h1 className="font-display mb-2 text-4xl tracking-wide uppercase sm:text-5xl">
          Запази час
        </h1>
        <p className="text-bone/60 mb-10">
          Без регистрация — само име и телефон. Отнема под минута.
        </p>
        {services.length === 0 ? (
          <p>
            Онлайн записването временно не е достъпно. Обадете се на{" "}
            <a
              href={`tel:${site.contact.phoneHref}`}
              className="text-brass underline underline-offset-4"
            >
              {site.contact.phone}
            </a>
            .
          </p>
        ) : (
          <BookingWizard
            services={services}
            barbers={barbers.map(({ id, name, bio }) => ({ id, name, bio }))}
            currency={env().CURRENCY}
            initialServiceId={sp.service}
            initialBarberId={sp.barber}
          />
        )}
      </div>
    </div>
  );
}
