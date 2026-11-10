import { SubmitButton } from "./action-form";

/** Бутони за свободните часове; всеки изпраща `start` (ISO с offset) към формата. */
export function SlotButtons({ slots }: { slots: { start: string; label: string }[] }) {
  if (slots.length === 0) {
    return <p className="text-bone/60 text-sm">Няма свободни часове за тази дата.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {slots.map((s) => (
        <SubmitButton key={s.start} name="start" value={s.start} variant="secondary">
          {s.label}
        </SubmitButton>
      ))}
    </div>
  );
}
