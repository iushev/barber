import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { SlotButtons } from "@/components/admin/slot-picker";
import { Card, Field, Flash, inputClass, PageHeader, StatusBadge } from "@/components/admin/ui";
import { env } from "@/config/env";
import { getDb } from "@/db";
import {
  formatDateTime,
  formatPhone,
  formatPrice,
  formatTime,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/format";
import { dateStringSchema } from "@/lib/validation/booking";
import { countBookingsByPhone } from "@/server/admin/bookings";
import { listBarbers } from "@/server/admin/catalog";
import { bookingService } from "@/server/booking";
import { zonedDateString } from "@/server/time";
import {
  anonymizeAction,
  deleteBookingAction,
  rescheduleBookingAction,
  setBookingStatusAction,
} from "../../../actions";

export const metadata = { title: "Резервация" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function BookingDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const svc = bookingService();
  const b = await svc.getBookingById(id);
  if (!b) notFound();

  const tz = env().BUSINESS_TIMEZONE;
  const db = getDb();
  const [barbers, samePhone] = await Promise.all([
    listBarbers(db),
    countBookingsByPhone(db, b.customerPhone),
  ]);

  const moveDate = dateStringSchema.safeParse(sp.date).success
    ? sp.date!
    : zonedDateString(b.start, tz);
  const moveBarber = barbers.find((x) => x.id === sp.barberId)?.id ?? b.barberId;
  const slots =
    b.status === "confirmed"
      ? await svc.getAdminSlots({
          barberId: moveBarber,
          date: moveDate,
          durationMin: b.durationMin,
          excludeBookingId: b.id,
        })
      : [];
  const anonymized = b.customerName === "Анонимизиран клиент" && !b.customerPhone;

  return (
    <>
      <PageHeader
        title="Резервация"
        back={{ href: "/admin/bookings", label: "Всички резервации" }}
      />
      {sp.created && <Flash>Резервацията е създадена.</Flash>}
      {sp.moved && <Flash>Часът е преместен.</Flash>}

      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Item label="Час">
            {formatDateTime(b.start, tz)} – {formatTime(b.end, tz)}
          </Item>
          <Item label="Статус">
            <StatusBadge status={b.status} />
          </Item>
          <Item label="Клиент">{b.customerName}</Item>
          <Item label="Телефон">
            {b.customerPhone ? (
              <a href={`tel:${b.customerPhone}`} className="text-brass hover:underline">
                {formatPhone(b.customerPhone)}
              </a>
            ) : (
              "—"
            )}
          </Item>
          <Item label="Услуга">
            {b.serviceName} · {b.durationMin} мин · {formatPrice(b.priceCents, b.currency)}
          </Item>
          <Item label="Бръснар">{b.barberName}</Item>
          <Item label="Източник">{SOURCE_LABELS[b.source]}</Item>
          <Item label="Създадена">{formatDateTime(b.createdAt, tz)}</Item>
        </dl>
        <p className="text-bone/60 mt-4 text-xs">
          Линкът за управление на клиента не може да се покаже: пазим само хеша на тайния токен.
        </p>
      </Card>

      <Card title="Статус">
        <ActionForm
          action={setBookingStatusAction.bind(null, b.id)}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label="Нов статус" name="status">
            <select id="status" name="status" defaultValue={b.status} className={inputClass}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <SubmitButton>Запази статуса</SubmitButton>
        </ActionForm>
      </Card>

      {b.status === "confirmed" && (
        <Card
          title="Преместване на час"
          description="Показани са свободните часове според графика (без ограничението за минимално време напред)."
        >
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="Дата" name="date">
              <input
                id="date"
                name="date"
                type="date"
                defaultValue={moveDate}
                className={inputClass}
              />
            </Field>
            <Field label="Бръснар" name="barberId">
              <select
                id="barberId"
                name="barberId"
                defaultValue={moveBarber}
                className={inputClass}
              >
                {barbers
                  .filter((x) => x.active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </Field>
            <button
              type="submit"
              className="border-bone/25 hover:bg-bone/10 rounded-md border px-4 py-2 text-sm"
            >
              Покажи часовете
            </button>
          </form>
          <ActionForm action={rescheduleBookingAction.bind(null, b.id)}>
            <input type="hidden" name="barberId" value={moveBarber} />
            <SlotButtons slots={slots} />
          </ActionForm>
        </Card>
      )}

      <Card
        title="Лични данни (GDPR)"
        description="Анонимизирането заменя името и телефона и изтрива чат историята в n8n. Действието е необратимо."
      >
        {/* Формата остава монтирана и след анонимизирането, за да не изчезне съобщението
            за резултата (вкл. предупреждението, ако n8n не е изчистил чат историята). */}
        <ActionForm
          action={anonymizeAction.bind(null, b.id)}
          className="flex flex-col gap-3 text-sm"
        >
          {anonymized ? (
            <p className="text-bone/60">Данните на тази резервация са анонимизирани.</p>
          ) : (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Обхват</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="scope" value="one" defaultChecked /> Само тази
                  резервация
                </label>
                {samePhone > 1 && (
                  <label className="flex items-center gap-2">
                    <input type="radio" name="scope" value="phone" /> Всички резервации с този
                    телефон ({samePhone})
                  </label>
                )}
              </fieldset>
              <label className="flex items-center gap-2 text-amber-200">
                <input type="checkbox" name="confirm" required /> Разбирам, че действието е
                необратимо.
              </label>
              <div>
                <SubmitButton variant="danger">Анонимизирай</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
        <hr className="border-bone/10 my-5" />
        <ActionForm
          action={deleteBookingAction.bind(null, b.id)}
          className="flex flex-col gap-3 text-sm"
        >
          <label className="flex items-center gap-2 text-amber-200">
            <input type="checkbox" name="confirm" required /> Изтрий резервацията окончателно (не
            остава в статистиката).
          </label>
          <div>
            <SubmitButton variant="danger">Изтрий</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-bone/60">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
