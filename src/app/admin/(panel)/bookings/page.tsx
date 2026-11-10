import Link from "next/link";
import {
  Card,
  Field,
  Flash,
  inputClass,
  LinkButton,
  PageHeader,
  StatusBadge,
} from "@/components/admin/ui";
import { env } from "@/config/env";
import { getDb } from "@/db";
import {
  formatDateTime,
  formatPhone,
  formatPrice,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/format";
import { listBookings, parseBookingFilters } from "@/server/admin/bookings";
import { listBarbers } from "@/server/admin/catalog";

export const metadata = { title: "Резервации" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = parseBookingFilters(sp);
  const tz = env().BUSINESS_TIMEZONE;
  const db = getDb();
  const [barbers, { rows, total, pageSize }] = await Promise.all([
    listBarbers(db),
    listBookings(db, filters, tz),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters))
      if (v !== undefined && k !== "page") q.set(k, String(v));
    q.set("page", String(page));
    return `/admin/bookings?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Резервации"
        actions={<LinkButton href="/admin/bookings/new">+ Нова резервация</LinkButton>}
      />
      {sp.deleted && <Flash>Резервацията е изтрита.</Flash>}

      <Card>
        <form
          method="get"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1.4fr_auto] lg:items-end"
        >
          <Field label="От дата" name="from">
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={filters.from}
              className={inputClass}
            />
          </Field>
          <Field label="До дата" name="to">
            <input id="to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
          </Field>
          <Field label="Бръснар" name="barberId">
            <select
              id="barberId"
              name="barberId"
              defaultValue={filters.barberId ?? ""}
              className={inputClass}
            >
              <option value="">Всички</option>
              {barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.active ? "" : " (неактивен)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Статус" name="status">
            <select
              id="status"
              name="status"
              defaultValue={filters.status ?? ""}
              className={inputClass}
            >
              <option value="">Всички</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Име или телефон" name="q">
            <input id="q" name="q" type="search" defaultValue={filters.q} className={inputClass} />
          </Field>
          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-brass text-ink hover:bg-brass/90 rounded-md px-4 py-2 text-sm font-medium"
            >
              Филтрирай
            </button>
            <Link
              href="/admin/bookings"
              className="border-bone/25 hover:bg-bone/10 rounded-md border px-4 py-2 text-sm"
            >
              Изчисти
            </Link>
          </div>
        </form>
      </Card>

      <p className="text-bone/60 mb-2 text-sm">Намерени: {total}</p>
      <div className="border-bone/10 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-coal text-bone/60">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Час
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Клиент
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Услуга
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Бръснар
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Статус
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Източник
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-bone/60 px-3 py-6 text-center">
                  Няма резервации по тези критерии.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-bone/10 hover:bg-bone/5 border-t">
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/admin/bookings/${r.id}`} className="text-brass hover:underline">
                    {formatDateTime(r.startAt, tz)}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {r.customerName}
                  <div className="text-bone/60 text-xs">{formatPhone(r.customerPhone)}</div>
                </td>
                <td className="px-3 py-2">
                  {r.serviceName}
                  <div className="text-bone/60 text-xs">
                    {formatPrice(r.priceCents, r.currency)}
                  </div>
                </td>
                <td className="px-3 py-2">{r.barberName}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="text-bone/70 px-3 py-2">{SOURCE_LABELS[r.source]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav aria-label="Страници" className="mt-4 flex items-center gap-3 text-sm">
          {filters.page > 1 && (
            <Link href={pageHref(filters.page - 1)} className="text-brass hover:underline">
              ← Предишна
            </Link>
          )}
          <span className="text-bone/60">
            Страница {filters.page} от {pages}
          </span>
          {filters.page < pages && (
            <Link href={pageHref(filters.page + 1)} className="text-brass hover:underline">
              Следваща →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
