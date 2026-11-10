import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AffectedBookings } from "@/components/admin/affected-bookings";
import { ServiceFields } from "@/components/admin/service-form";
import { ActiveBadge, Card, PageHeader } from "@/components/admin/ui";
import { env } from "@/config/env";
import { getDb } from "@/db";
import { futureBookingsFor, getService } from "@/server/admin/catalog";
import { setServiceActiveAction, updateServiceAction } from "../../../actions";

export const metadata = { title: "Услуга" };

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const service = await getService(db, id);
  if (!service) notFound();
  const affected = await futureBookingsFor(db, { serviceId: id });
  const tz = env().BUSINESS_TIMEZONE;

  return (
    <>
      <PageHeader
        title={service.name}
        back={{ href: "/admin/services", label: "Услуги" }}
        actions={<ActiveBadge active={service.active} />}
      />
      <Card
        title="Данни"
        description="Промяната на цена или продължителност не засяга вече записаните часове — те пазят стойностите от момента на записване."
      >
        <ActionForm action={updateServiceAction.bind(null, id)}>
          <ServiceFields defaults={service} />
        </ActionForm>
      </Card>

      <Card title={service.active ? "Деактивиране" : "Активиране"}>
        {service.active && (
          <div className="mb-4">
            <AffectedBookings rows={affected} tz={tz} />
          </div>
        )}
        <ActionForm action={setServiceActiveAction.bind(null, id)}>
          <input type="hidden" name="active" value={service.active ? "false" : "true"} />
          {service.active && affected.length > 0 && (
            <label className="mb-3 flex items-start gap-2 text-sm text-amber-200">
              <input type="checkbox" name="confirm" className="mt-1" />
              <span>
                Разбирам, че {affected.length} предстоящи резервации остават и трябва да ги обработя
                ръчно.
              </span>
            </label>
          )}
          <SubmitButton variant={service.active ? "danger" : "primary"}>
            {service.active ? "Деактивирай" : "Активирай"}
          </SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
