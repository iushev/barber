import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { ServiceFields } from "@/components/admin/service-form";
import { ActiveBadge, Card, PageHeader } from "@/components/admin/ui";
import { env } from "@/config/env";
import { getDb } from "@/db";
import { formatPrice } from "@/lib/format";
import { listServices } from "@/server/admin/catalog";
import { createServiceAction } from "../../actions";

export const metadata = { title: "Услуги" };

export default async function ServicesPage() {
  const services = await listServices(getDb());
  const currency = env().CURRENCY;
  return (
    <>
      <PageHeader title="Услуги" />
      <Card>
        {services.length === 0 ? (
          <p className="text-bone/60 text-sm">Все още няма услуги.</p>
        ) : (
          <ul className="divide-bone/10 divide-y">
            {services.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Link
                  href={`/admin/services/${s.id}`}
                  className="text-brass font-medium hover:underline"
                >
                  {s.name}
                </Link>
                <span className="text-bone/70 flex items-center gap-3 text-sm">
                  {s.durationMin} мин · {formatPrice(s.priceCents, currency)}
                  <ActiveBadge active={s.active} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Нова услуга">
        <ActionForm action={createServiceAction}>
          <ServiceFields />
        </ActionForm>
      </Card>
    </>
  );
}
