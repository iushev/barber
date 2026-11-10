import Image from "next/image";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AffectedBookings } from "@/components/admin/affected-bookings";
import { BarberFields } from "@/components/admin/barber-form";
import { ActiveBadge, Card, Field, inputClass, PageHeader } from "@/components/admin/ui";
import { env } from "@/config/env";
import { getDb } from "@/db";
import { WEEKDAY_LABELS } from "@/lib/format";
import {
  futureBookingsFor,
  getBarber,
  getWeeklySchedule,
  listExceptions,
  listServices,
} from "@/server/admin/catalog";
import { zonedDateString } from "@/server/time";
import {
  deleteExceptionAction,
  removeBarberPhotoAction,
  saveScheduleAction,
  setBarberActiveAction,
  updateBarberAction,
  uploadBarberPhotoAction,
  upsertExceptionAction,
} from "../../../actions";

export const metadata = { title: "Бръснар" };

export default async function BarberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const barber = await getBarber(db, id);
  if (!barber) notFound();
  const tz = env().BUSINESS_TIMEZONE;
  const today = zonedDateString(new Date(), tz);
  const [services, schedule, exceptions, affected] = await Promise.all([
    listServices(db),
    getWeeklySchedule(db, id),
    listExceptions(db, id, today),
    futureBookingsFor(db, { barberId: id }),
  ]);

  return (
    <>
      <PageHeader
        title={barber.name}
        back={{ href: "/admin/barbers", label: "Бръснари" }}
        actions={<ActiveBadge active={barber.active} />}
      />

      <Card title="Данни и услуги">
        <ActionForm action={updateBarberAction.bind(null, id)}>
          <BarberFields defaults={barber} services={services} />
        </ActionForm>
      </Card>

      <Card
        title="Снимка"
        description="JPEG, PNG или WebP до 2 MB. Препоръчително: квадратна, поне 600×600 px."
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {barber.photoPath ? (
            <Image
              src={`/uploads/${barber.photoPath}`}
              alt={`Снимка на ${barber.name}`}
              width={160}
              height={160}
              unoptimized
              className="h-40 w-40 rounded-md object-cover"
            />
          ) : (
            <div className="border-bone/20 text-bone/60 flex h-40 w-40 items-center justify-center rounded-md border border-dashed text-xs">
              Няма снимка
            </div>
          )}
          <div className="flex flex-col gap-3">
            <ActionForm
              action={uploadBarberPhotoAction.bind(null, id)}
              className="flex flex-col gap-2"
            >
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Файл със снимка"
                className="file:bg-bone/10 file:text-bone text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-2"
              />
              <div>
                <SubmitButton>Качи</SubmitButton>
              </div>
            </ActionForm>
            {barber.photoPath && (
              <ActionForm action={removeBarberPhotoAction.bind(null, id)}>
                <SubmitButton variant="secondary">Премахни снимката</SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
      </Card>

      <Card title="Седмичен график" description="Отметнете работните дни. Почивката е по избор.">
        <ActionForm action={saveScheduleAction.bind(null, id)}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-bone/60 text-left">
                <tr>
                  <th scope="col" className="py-2 font-medium">
                    Ден
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Начало
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Край
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Почивка от
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Почивка до
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((d, i) => (
                  <tr key={i} className="border-bone/10 border-t">
                    <td className="py-2 pr-3">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name={`d${i}_enabled`} defaultChecked={d.enabled} />
                        {WEEKDAY_LABELS[i]}
                      </label>
                    </td>
                    {(["start", "end", "breakStart", "breakEnd"] as const).map((k) => (
                      <td key={k} className="py-2 pr-3">
                        <input
                          type="time"
                          step={300}
                          name={`d${i}_${k}`}
                          aria-label={`${WEEKDAY_LABELS[i]} — ${TIME_LABELS[k]}`}
                          defaultValue={d.enabled ? (d[k] ?? "") : ""}
                          className={inputClass}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <SubmitButton>Запази графика</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card
        title="Изключения за дати"
        description="Отпуск, празник (почивен ден) или различно работно време за конкретна дата."
      >
        {exceptions.length > 0 && (
          <ul className="divide-bone/10 mb-4 divide-y text-sm">
            {exceptions.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{e.date}</strong> ·{" "}
                  {e.type === "off"
                    ? "Почивен ден"
                    : `${e.startTime?.slice(0, 5)}–${e.endTime?.slice(0, 5)}${e.breakStart ? `, почивка ${e.breakStart.slice(0, 5)}–${e.breakEnd?.slice(0, 5)}` : ""}`}
                  {e.note && <span className="text-bone/60"> · {e.note}</span>}
                </span>
                <ActionForm action={deleteExceptionAction.bind(null, id, e.id)}>
                  <SubmitButton variant="secondary">Изтрий</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm
          action={upsertExceptionAction.bind(null, id)}
          className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-7 lg:items-end"
        >
          <Field label="Дата" name="ex-date">
            <input
              id="ex-date"
              name="date"
              type="date"
              min={today}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Вид" name="ex-type">
            <select id="ex-type" name="type" className={inputClass}>
              <option value="off">Почивен ден</option>
              <option value="custom">Друго работно време</option>
            </select>
          </Field>
          <Field label="Начало" name="ex-start">
            <input id="ex-start" name="start" type="time" step={300} className={inputClass} />
          </Field>
          <Field label="Край" name="ex-end">
            <input id="ex-end" name="end" type="time" step={300} className={inputClass} />
          </Field>
          <Field label="Почивка от" name="ex-bs">
            <input id="ex-bs" name="breakStart" type="time" step={300} className={inputClass} />
          </Field>
          <Field label="Почивка до" name="ex-be">
            <input id="ex-be" name="breakEnd" type="time" step={300} className={inputClass} />
          </Field>
          <Field label="Бележка" name="ex-note">
            <input id="ex-note" name="note" maxLength={200} className={inputClass} />
          </Field>
          <div className="lg:col-span-7">
            <SubmitButton>Добави изключение</SubmitButton>
          </div>
        </ActionForm>
        <p className="text-bone/60 mt-3 text-xs">
          Изключението не отменя вече записани часове — проверете резервациите за тази дата.
        </p>
      </Card>

      <Card title={barber.active ? "Деактивиране" : "Активиране"}>
        {barber.active && (
          <div className="mb-4">
            <AffectedBookings rows={affected} tz={tz} />
          </div>
        )}
        <ActionForm action={setBarberActiveAction.bind(null, id)}>
          <input type="hidden" name="active" value={barber.active ? "false" : "true"} />
          {barber.active && affected.length > 0 && (
            <label className="mb-3 flex items-start gap-2 text-sm text-amber-200">
              <input type="checkbox" name="confirm" className="mt-1" />
              <span>
                Разбирам, че {affected.length} предстоящи резервации остават и трябва да ги обработя
                ръчно.
              </span>
            </label>
          )}
          <SubmitButton variant={barber.active ? "danger" : "primary"}>
            {barber.active ? "Деактивирай" : "Активирай"}
          </SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}

const TIME_LABELS = {
  start: "начало",
  end: "край",
  breakStart: "почивка от",
  breakEnd: "почивка до",
} as const;
