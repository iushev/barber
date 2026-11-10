import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelBooking } from "@/components/booking/cancel-booking";
import { ManageLink } from "@/components/booking/manage-link";
import { env } from "@/config/env";
import { site } from "@/config/site";
import { formatDate, formatPrice, formatTime, STATUS_LABELS } from "@/lib/format";
import { bookingService } from "@/server/booking";
import { cancelBookingAction } from "../../actions";

// Тайният токен е в URL-а: без индексиране и без Referer към други сайтове.
export const metadata: Metadata = {
  title: "Вашата резервация",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function BookingPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { new: isNew } = await searchParams;
  const svc = bookingService();
  const b = await svc.getBookingByToken(token);
  if (!b) notFound();

  const { BUSINESS_TIMEZONE: tz, PUBLIC_BASE_URL } = env();
  const manageUrl = new URL(`/booking/${token}`, PUBLIC_BASE_URL).toString();
  const canCancel = svc.canCustomerCancel(b);
  const upcoming = svc.isUpcoming(b);

  return (
    <div className="grain">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
        {isNew && b.status === "confirmed" && (
          <div role="status" className="border-brass/50 bg-brass/10 mb-10 rounded-sm border p-5">
            <p className="font-display text-brass text-2xl tracking-wide uppercase">
              Записахте час!
            </p>
            <p className="mt-2">
              Очакваме ви. Ето детайлите и линка за управление на резервацията.
            </p>
          </div>
        )}

        <h1 className="font-display mb-8 text-4xl tracking-wide uppercase">Вашата резервация</h1>

        <dl className="border-bone/15 bg-coal divide-bone/10 divide-y rounded-sm border">
          {[
            ["Статус", STATUS_LABELS[b.status]],
            ["Дата", formatDate(b.start, tz)],
            ["Час", `${formatTime(b.start, tz)} – ${formatTime(b.end, tz)}`],
            ["Услуга", `${b.serviceName} (${b.durationMin} мин)`],
            ["Цена", formatPrice(b.priceCents, b.currency)],
            ["Бръснар", b.barberName],
            ["Име", b.customerName],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-bone/60">{k}</dt>
              <dd
                className={`text-right first-letter:uppercase ${k === "Статус" && b.status === "cancelled" ? "text-red-300" : ""}`}
              >
                {v}
              </dd>
            </div>
          ))}
        </dl>

        <section
          aria-labelledby="link-title"
          className="border-brass/40 mt-10 rounded-sm border border-dashed p-5"
        >
          <h2 id="link-title" className="font-display text-xl tracking-wide uppercase">
            Запазете този линк
          </h2>
          <p className="text-bone/70 mt-2 mb-4 text-sm">
            Не изпращаме имейл или SMS. Този линк е единственият начин да видите или отмените часа
            си онлайн — добавете го в отметките или си направете снимка на екрана. Не го споделяйте:
            всеки с линка може да отмени резервацията.
          </p>
          <ManageLink url={manageUrl} />
        </section>

        {b.status === "confirmed" && upcoming && (
          <section aria-labelledby="cancel-title" className="mt-10">
            <h2 id="cancel-title" className="font-display mb-3 text-xl tracking-wide uppercase">
              Отмяна
            </h2>
            {canCancel ? (
              <>
                <p className="text-bone/70 mb-4 text-sm">
                  Ако няма да успеете, отменете часа, за да го освободим за друг клиент.
                </p>
                <CancelBooking action={cancelBookingAction.bind(null, token)} />
              </>
            ) : (
              <p className="text-bone/70 text-sm">
                Онлайн отмяна е възможна до {svc.rules.cancelCutoffHours} ч. преди часа. Моля,
                обадете се на{" "}
                <a
                  href={`tel:${site.contact.phoneHref}`}
                  className="text-brass underline underline-offset-4"
                >
                  {site.contact.phone}
                </a>
                .
              </p>
            )}
          </section>
        )}

        <p className="mt-12 text-sm">
          <Link href="/" className="text-brass hover:text-bone">
            ← Към началната страница
          </Link>
        </p>
      </div>
    </div>
  );
}
