"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createBookingAction, type BookingFormResult } from "@/app/(public)/actions";
import { formatPrice } from "@/lib/format";
import { customerNameSchema, customerPhoneSchema } from "@/lib/validation/booking";
import { Calendar, formatDateLabel } from "./calendar";

export interface WizardService {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
  barbers: { id: string; name: string }[];
}
export interface WizardBarber {
  id: string;
  name: string;
  bio: string;
}
interface Slot {
  start: string;
  end: string;
  label: string;
}
type Load<T> = { status: "idle" | "loading" | "error"; data?: T; error?: string };

const STEPS = ["Услуга", "Бръснар", "Дата", "Час", "Данни", "Потвърждение"] as const;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message ?? "Възникна грешка при зареждането.");
  return body as T;
}

export function BookingWizard({
  services,
  barbers,
  currency,
  initialServiceId,
  initialBarberId,
}: {
  services: WizardService[];
  barbers: WizardBarber[];
  currency: string;
  initialServiceId?: string;
  initialBarberId?: string;
}) {
  const presetService = services.find((s) => s.id === initialServiceId && s.barbers.length > 0);
  const [step, setStep] = useState(presetService ? 2 : 1);
  const [serviceId, setServiceId] = useState<string | null>(presetService?.id ?? null);
  const [barberId, setBarberId] = useState<string | null>(null);
  const [preferredBarber] = useState(initialBarberId ?? null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<
    Load<{ from: string; to: string; dates: string[] }>
  >({ status: "idle" });
  const [month, setMonth] = useState<string>("");
  const [slots, setSlots] = useState<Load<Slot[]>>({ status: "idle" });
  const [result, setResult] = useState<BookingFormResult>(undefined);
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const barber = service?.barbers.find((b) => b.id === barberId) ?? null;
  const barberInfo = (id: string) => barbers.find((b) => b.id === id);
  const availableSet = useMemo(() => new Set(availability.data?.dates ?? []), [availability.data]);

  // Фокус върху заглавието на стъпката (екранни четци и клавиатура).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  // Пази се от закъснели отговори: важи само последната заявка от всеки вид.
  const requestSeq = useRef({ availability: 0, slots: 0 });

  function loadAvailability(sId: string, bId: string) {
    const seq = ++requestSeq.current.availability;
    setAvailability({ status: "loading" });
    getJson<{ from: string; to: string; dates: string[] }>(
      `/api/public/availability?serviceId=${sId}&barberId=${bId}`,
    )
      .then((data) => {
        if (seq !== requestSeq.current.availability) return;
        setAvailability({ status: "idle", data });
        setMonth((data.dates[0] ?? data.from).slice(0, 7));
      })
      .catch((e: Error) => {
        if (seq === requestSeq.current.availability)
          setAvailability({ status: "error", error: e.message });
      });
  }

  function loadSlots(sId: string, bId: string, d: string) {
    const seq = ++requestSeq.current.slots;
    setSlots({ status: "loading" });
    getJson<{ slots: Slot[] }>(`/api/public/slots?serviceId=${sId}&barberId=${bId}&date=${d}`)
      .then((r) => {
        if (seq === requestSeq.current.slots) setSlots({ status: "idle", data: r.slots });
      })
      .catch((e: Error) => {
        if (seq === requestSeq.current.slots) setSlots({ status: "error", error: e.message });
      });
  }

  function chooseBarber(sId: string, bId: string) {
    setBarberId(bId);
    setDate(null);
    setSlot(null);
    loadAvailability(sId, bId);
    setStep(3);
  }

  function chooseDate(d: string) {
    if (!serviceId || !barberId) return;
    setDate(d);
    setSlot(null);
    loadSlots(serviceId, barberId, d);
    setStep(4);
  }

  function chooseService(id: string) {
    setServiceId(id);
    setDate(null);
    setSlot(null);
    const s = services.find((x) => x.id === id);
    const pref = s?.barbers.find((b) => b.id === preferredBarber);
    if (pref) {
      chooseBarber(id, pref.id);
    } else {
      setBarberId(null);
      setStep(2);
    }
  }

  function validateDetails(): boolean {
    const errs: Record<string, string> = {};
    const n = customerNameSchema.safeParse(name);
    if (!n.success) errs.customerName = n.error.issues[0]?.message ?? "Невалидно име.";
    const p = customerPhoneSchema.safeParse(phone);
    if (!p.success) errs.customerPhone = p.error.issues[0]?.message ?? "Невалиден телефон.";
    if (!consent) errs.consent = "Необходимо е съгласие за обработка на личните данни.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function submit() {
    if (!service || !barber || !slot) return;
    setResult(undefined);
    startTransition(async () => {
      const r = await createBookingAction({
        serviceId: service.id,
        barberId: barber.id,
        start: slot.start,
        customerName: name,
        customerPhone: phone,
        consent,
        website,
      });
      // При успех сървърът пренасочва към /booking/<token>; тук стигаме само при грешка.
      setResult(r);
      if (r?.fields) setFieldErrors(r.fields);
    });
  }

  function chooseAlternative(alt: Slot) {
    const d = alt.start.slice(0, 10);
    setDate(d);
    setSlot(alt);
    setResult(undefined);
    if (serviceId && barberId) loadSlots(serviceId, barberId, d);
  }

  const card = (selected: boolean) =>
    `w-full rounded-sm border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass ${
      selected ? "border-brass bg-brass/10" : "border-bone/15 bg-coal hover:border-bone/40"
    }`;
  const stepTitle = (text: string) => (
    <h2
      ref={headingRef}
      tabIndex={-1}
      className="font-display mb-6 text-2xl tracking-wide uppercase outline-none sm:text-3xl"
    >
      {text}
    </h2>
  );
  const back = (to: number) => (
    <button
      type="button"
      onClick={() => setStep(to)}
      className="text-bone/60 hover:text-brass mt-8 text-sm"
    >
      ← Назад
    </button>
  );

  return (
    <div>
      {/* Прогрес */}
      <ol className="mb-10 grid grid-cols-6 gap-1" aria-label="Стъпки на записването">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "todo";
          return (
            <li key={label} aria-current={state === "current" ? "step" : undefined}>
              <span
                className={`block h-1 rounded-full ${state === "todo" ? "bg-bone/15" : "bg-brass"}`}
              />
              <span
                className={`mt-2 hidden text-xs sm:block ${state === "current" ? "text-brass" : "text-bone/60"}`}
              >
                {n}. {label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        Стъпка {step} от {STEPS.length}: {STEPS[step - 1]}
      </p>

      {step === 1 && (
        <section>
          {stepTitle("Изберете услуга")}
          <ul className="grid gap-3 sm:grid-cols-2">
            {services
              .filter((s) => s.barbers.length > 0)
              .map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => chooseService(s.id)}
                    className={card(s.id === serviceId)}
                    aria-pressed={s.id === serviceId}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-display text-lg tracking-wide uppercase">{s.name}</span>
                      <span className="text-brass font-semibold whitespace-nowrap">
                        {formatPrice(s.priceCents, currency)}
                      </span>
                    </span>
                    <span className="text-bone/60 mt-1 block text-sm">
                      {s.durationMin} мин{s.description ? ` · ${s.description}` : ""}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}

      {step === 2 && service && (
        <section>
          {stepTitle("Изберете бръснар")}
          <p className="text-bone/60 -mt-4 mb-6 text-sm">За „{service.name}“</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {service.barbers.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => chooseBarber(service.id, b.id)}
                  className={card(b.id === barberId)}
                  aria-pressed={b.id === barberId}
                >
                  <span className="font-display block text-lg tracking-wide uppercase">
                    {b.name}
                  </span>
                  {barberInfo(b.id)?.bio && (
                    <span className="text-bone/60 mt-1 block text-sm">{barberInfo(b.id)!.bio}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {back(1)}
        </section>
      )}

      {step === 3 && service && barber && (
        <section>
          {stepTitle("Изберете дата")}
          <p className="text-bone/60 -mt-4 mb-6 text-sm">
            {service.name} при {barber.name}
          </p>
          {availability.status === "loading" && <p role="status">Зареждане на свободните дати…</p>}
          {availability.status === "error" && (
            <p role="alert" className="text-red-300">
              {availability.error}
            </p>
          )}
          {availability.data &&
            month &&
            (availability.data.dates.length === 0 ? (
              <p className="text-bone/70">
                В момента няма свободни часове при {barber.name}. Изберете друг бръснар или ни се
                обадете.
              </p>
            ) : (
              <Calendar
                month={month}
                onMonthChange={setMonth}
                available={availableSet}
                minMonth={availability.data.from.slice(0, 7)}
                maxMonth={availability.data.to.slice(0, 7)}
                selected={date}
                onSelect={chooseDate}
              />
            ))}
          {back(service.barbers.length > 1 ? 2 : 1)}
        </section>
      )}

      {step === 4 && service && barber && date && (
        <section>
          {stepTitle("Изберете час")}
          <p className="text-bone/60 -mt-4 mb-6 text-sm first-letter:uppercase">
            {formatDateLabel(date)}
          </p>
          {slots.status === "loading" && <p role="status">Зареждане на свободните часове…</p>}
          {slots.status === "error" && (
            <p role="alert" className="text-red-300">
              {slots.error}
            </p>
          )}
          {slots.data &&
            slots.status === "idle" &&
            (slots.data.length === 0 ? (
              <p className="text-bone/70">
                Няма свободни часове за тази дата. Изберете друга дата.
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                {slots.data.map((s) => (
                  <li key={s.start}>
                    <button
                      type="button"
                      onClick={() => {
                        setSlot(s);
                        setStep(5);
                      }}
                      aria-pressed={slot?.start === s.start}
                      className={`${card(slot?.start === s.start)} py-3 text-center tabular-nums`}
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          {back(3)}
        </section>
      )}

      {step === 5 && slot && (
        <section>
          {stepTitle("Вашите данни")}
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (validateDetails()) setStep(6);
            }}
            className="max-w-md space-y-5"
          >
            <div>
              <label htmlFor="customerName" className="mb-1 block text-sm font-medium">
                Име
              </label>
              <input
                id="customerName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                maxLength={80}
                aria-invalid={!!fieldErrors.customerName}
                aria-describedby={fieldErrors.customerName ? "err-name" : undefined}
                className="border-bone/25 bg-coal focus:border-brass w-full rounded-sm border px-3 py-3 outline-none"
              />
              {fieldErrors.customerName && (
                <p id="err-name" className="mt-1 text-sm text-red-300">
                  {fieldErrors.customerName}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="customerPhone" className="mb-1 block text-sm font-medium">
                Телефон
              </label>
              <input
                id="customerPhone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                required
                maxLength={25}
                placeholder="0888 123 456"
                aria-invalid={!!fieldErrors.customerPhone}
                aria-describedby={`hint-phone${fieldErrors.customerPhone ? " err-phone" : ""}`}
                className="border-bone/25 bg-coal focus:border-brass w-full rounded-sm border px-3 py-3 outline-none"
              />
              <p id="hint-phone" className="text-bone/60 mt-1 text-xs">
                Български или международен номер (с код на държавата, напр. +44…). Ще ви се обадим
                само при нужда.
              </p>
              {fieldErrors.customerPhone && (
                <p id="err-phone" className="mt-1 text-sm text-red-300">
                  {fieldErrors.customerPhone}
                </p>
              )}
            </div>
            {/* Honeypot: скрито за хора, ботовете го попълват. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="website">Уебсайт</label>
              <input
                id="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            <div>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  aria-invalid={!!fieldErrors.consent}
                  aria-describedby={fieldErrors.consent ? "err-consent" : undefined}
                  className="accent-brass mt-1 h-4 w-4"
                />
                <span>
                  Съгласен съм името и телефонът ми да бъдат обработени за целите на записването,
                  съгласно{" "}
                  <Link href="/privacy" target="_blank" className="text-brass underline">
                    политиката за поверителност
                  </Link>
                  .
                </span>
              </label>
              {fieldErrors.consent && (
                <p id="err-consent" className="mt-1 text-sm text-red-300">
                  {fieldErrors.consent}
                </p>
              )}
            </div>
            <button
              type="submit"
              className="bg-brass text-ink hover:bg-bone rounded-sm px-6 py-3 font-semibold tracking-wider uppercase"
            >
              Напред
            </button>
          </form>
          {back(4)}
        </section>
      )}

      {step === 6 && service && barber && slot && (
        <section>
          {stepTitle("Потвърдете записването")}
          <dl className="border-bone/15 bg-coal divide-bone/10 max-w-md divide-y rounded-sm border">
            {[
              ["Услуга", `${service.name} (${service.durationMin} мин)`],
              ["Цена", formatPrice(service.priceCents, currency)],
              ["Бръснар", barber.name],
              ["Дата", formatDateLabel(slot.start.slice(0, 10))],
              ["Час", slot.label],
              ["Име", name.trim().replace(/\s+/g, " ")],
              ["Телефон", phone],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-3 text-sm">
                <dt className="text-bone/60">{k}</dt>
                <dd className="text-right first-letter:uppercase">{v}</dd>
              </div>
            ))}
          </dl>

          {result && (
            <div
              role="alert"
              className="mt-6 max-w-md rounded-sm border border-red-400/40 bg-red-950/40 p-4 text-sm"
            >
              <p>{result.error}</p>
              {result.alternatives && result.alternatives.length > 0 && (
                <div className="mt-3">
                  <p className="text-bone/70 mb-2">Изберете друг час:</p>
                  <ul className="flex flex-wrap gap-2">
                    {result.alternatives.map((a) => (
                      <li key={a.start}>
                        <button
                          type="button"
                          onClick={() => chooseAlternative(a)}
                          className="border-brass text-brass hover:bg-brass hover:text-ink rounded-sm border px-3 py-2 tabular-nums"
                        >
                          {a.start.slice(0, 10) === slot.start.slice(0, 10)
                            ? a.label
                            : `${formatDateLabel(a.start.slice(0, 10))}, ${a.label}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.fields && (result.fields.customerName || result.fields.customerPhone) && (
                <button
                  type="button"
                  onClick={() => setStep(5)}
                  className="text-brass mt-3 underline"
                >
                  Коригирай данните
                </button>
              )}
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="bg-brass text-ink hover:bg-bone rounded-sm px-7 py-4 font-semibold tracking-wider uppercase disabled:opacity-60"
            >
              {pending ? "Записване…" : "Потвърди записването"}
            </button>
            <button
              type="button"
              onClick={() => setStep(5)}
              className="text-bone/60 hover:text-brass text-sm"
            >
              ← Промени данните
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
