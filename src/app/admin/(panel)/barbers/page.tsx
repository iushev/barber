import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { BarberFields } from "@/components/admin/barber-form";
import { ActiveBadge, Card, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { listBarbers, listServices } from "@/server/admin/catalog";
import { createBarberAction } from "../../actions";

export const metadata = { title: "Бръснари" };

export default async function BarbersPage() {
  const db = getDb();
  const [barbers, services] = await Promise.all([listBarbers(db), listServices(db)]);
  return (
    <>
      <PageHeader title="Бръснари" />
      <Card>
        {barbers.length === 0 ? (
          <p className="text-bone/60 text-sm">Все още няма бръснари.</p>
        ) : (
          <ul className="divide-bone/10 divide-y">
            {barbers.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-3">
                <Link
                  href={`/admin/barbers/${b.id}`}
                  className="text-brass font-medium hover:underline"
                >
                  {b.name}
                </Link>
                <ActiveBadge active={b.active} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Нов бръснар"
        description="Работното време и снимката се задават след създаването."
      >
        <ActionForm action={createBarberAction}>
          <BarberFields services={services} />
        </ActionForm>
      </Card>
    </>
  );
}
