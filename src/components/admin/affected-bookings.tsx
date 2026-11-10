import Link from "next/link";
import { formatDateTime, formatPhone } from "@/lib/format";

export interface AffectedBooking {
  id: string;
  startAt: Date;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  barberName: string;
}

/** Списък с предстоящи резервации, засегнати от деактивиране. */
export function AffectedBookings({ rows, tz }: { rows: AffectedBooking[]; tz: string }) {
  if (rows.length === 0) {
    return <p className="text-bone/60 text-sm">Няма предстоящи резервации.</p>;
  }
  return (
    <div className="rounded-md border border-amber-400/30 bg-amber-950/30 p-3 text-sm">
      <p className="mb-2 font-medium text-amber-200">
        Предстоящи резервации ({rows.length}). При деактивиране те НЕ се отменят автоматично —
        преместете или отменете всяка, след като се свържете с клиента.
      </p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/bookings/${r.id}`} className="text-brass hover:underline">
              {formatDateTime(r.startAt, tz)}
            </Link>{" "}
            · {r.serviceName} · {r.barberName} · {r.customerName} ({formatPhone(r.customerPhone)})
          </li>
        ))}
      </ul>
    </div>
  );
}
