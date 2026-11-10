import { ActionForm } from "@/components/admin/action-form";
import { SlotButtons } from "@/components/admin/slot-picker";
import { Card, Field, inputClass, PageHeader } from "@/components/admin/ui";
import { env } from "@/config/env";
import { formatPrice } from "@/lib/format";
import { dateStringSchema } from "@/lib/validation/booking";
import { bookingService } from "@/server/booking";
import { zonedDateString } from "@/server/time";
import { createAdminBookingAction } from "../../../actions";

export const metadata = { title: "Нова резервация" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

/**
 * Ръчно добавяне (напр. по телефон): услуга → бръснар → дата чрез GET формата,
 * после име, телефон и избор на свободен час. Важат графикът и защитата от
 * застъпване; не важат минималното време напред, хоризонтът и лимитите.
 */
export default async function NewBookingPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { BUSINESS_TIMEZONE: tz, CURRENCY } = env();
  const svc = bookingService();
  const services = await svc.listActiveServices();
  const service = services.find((s) => s.id === sp.serviceId);
  const barber = service?.barbers.find((b) => b.id === sp.barberId);
  const date = dateStringSchema.safeParse(sp.date).success
    ? sp.date!
    : zonedDateString(new Date(), tz);
  const slots =
    service && barber
      ? await svc.getAdminSlots({ barberId: barber.id, date, durationMin: service.durationMin })
      : null;

  return (
    <>
      <PageHeader title="Нова резервация" back={{ href: "/admin/bookings", label: "Резервации" }} />
      <Card title="1. Услуга, бръснар и дата">
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Услуга" name="serviceId">
            <select
              id="serviceId"
              name="serviceId"
              defaultValue={service?.id ?? ""}
              className={inputClass}
              required
            >
              <option value="" disabled>
                Изберете…
              </option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.durationMin} мин · {formatPrice(s.priceCents, CURRENCY)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Бръснар"
            name="barberId"
            hint={service ? undefined : "Първо изберете услуга и натиснете „Покажи“."}
          >
            <select
              id="barberId"
              name="barberId"
              defaultValue={barber?.id ?? ""}
              className={inputClass}
            >
              <option value="">{service ? "Изберете…" : "—"}</option>
              {service?.barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Дата" name="date">
            <input id="date" name="date" type="date" defaultValue={date} className={inputClass} />
          </Field>
          <button
            type="submit"
            className="border-bone/25 hover:bg-bone/10 rounded-md border px-4 py-2 text-sm"
          >
            Покажи
          </button>
        </form>
      </Card>

      {service && barber && slots && (
        <Card title="2. Клиент и час" description={`${service.name} при ${barber.name}`}>
          <ActionForm action={createAdminBookingAction} className="flex flex-col gap-4">
            <input type="hidden" name="serviceId" value={service.id} />
            <input type="hidden" name="barberId" value={barber.id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Име" name="customerName">
                <input
                  id="customerName"
                  name="customerName"
                  required
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
              <Field label="Телефон" name="customerPhone" hint="Български или международен номер.">
                <input
                  id="customerPhone"
                  name="customerPhone"
                  type="tel"
                  required
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
            </div>
            <div>
              <p className="text-bone/80 mb-2 text-sm font-medium">
                Свободен час (натиснете, за да запишете):
              </p>
              <SlotButtons slots={slots} />
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
