import { SubmitButton } from "./action-form";
import { Field, inputClass } from "./ui";

export function ServiceFields({
  defaults,
}: {
  defaults?: {
    name: string;
    description: string;
    durationMin: number;
    priceCents: number;
    sortOrder: number;
  };
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Име" name="name">
          <input
            id="name"
            name="name"
            required
            defaultValue={defaults?.name}
            className={inputClass}
          />
        </Field>
        <Field label="Продължителност (мин)" name="durationMin" hint="Кратна на 5.">
          <input
            id="durationMin"
            name="durationMin"
            type="number"
            min={5}
            max={480}
            step={5}
            required
            defaultValue={defaults?.durationMin ?? 30}
            className={inputClass}
          />
        </Field>
        <Field label="Цена" name="price" hint="Напр. 25 или 25.50">
          <input
            id="price"
            name="price"
            inputMode="decimal"
            required
            defaultValue={defaults ? (defaults.priceCents / 100).toFixed(2) : ""}
            className={inputClass}
          />
        </Field>
        <Field label="Подредба" name="sortOrder">
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
      <Field label="Описание" name="description">
        <textarea
          id="description"
          name="description"
          rows={2}
          maxLength={600}
          defaultValue={defaults?.description}
          className={inputClass}
        />
      </Field>
      <div>
        <SubmitButton>Запази</SubmitButton>
      </div>
    </div>
  );
}
