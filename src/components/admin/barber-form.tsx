import { SubmitButton } from "./action-form";
import { Field, inputClass } from "./ui";

/** Полетата на бръснар (споделени между създаване и редакция). */
export function BarberFields({
  defaults,
  services,
}: {
  defaults?: { name: string; slug: string; bio: string; sortOrder: number; serviceIds: string[] };
  services: { id: string; name: string; active: boolean }[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Име" name="name">
          <input
            id="name"
            name="name"
            required
            defaultValue={defaults?.name}
            className={inputClass}
          />
        </Field>
        <Field
          label="Адрес (slug)"
          name="slug"
          hint="Малки латински букви, цифри и тирета, напр. georgi."
        >
          <input
            id="slug"
            name="slug"
            required
            pattern="[a-z0-9\-]+"
            defaultValue={defaults?.slug}
            className={inputClass}
          />
        </Field>
        <Field label="Подредба" name="sortOrder" hint="По-малкото число е по-напред.">
          <input
            id="sortOrder"
            name="sortOrder"
            type="number"
            min={0}
            max={999}
            defaultValue={defaults?.sortOrder ?? 0}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Кратко описание" name="bio">
        <textarea
          id="bio"
          name="bio"
          rows={3}
          maxLength={600}
          defaultValue={defaults?.bio}
          className={inputClass}
        />
      </Field>
      <fieldset>
        <legend className="text-bone/80 mb-2 text-sm font-medium">Услуги, които извършва</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="serviceIds"
                value={s.id}
                defaultChecked={defaults?.serviceIds.includes(s.id)}
              />
              {s.name}
              {!s.active && <span className="text-bone/60 text-xs">(неактивна)</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <SubmitButton>Запази</SubmitButton>
      </div>
    </div>
  );
}
