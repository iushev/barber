/**
 * Zod схеми, споделени между клиента (формата) и сървъра (booking service, API).
 * Сървърът ВИНАГИ валидира отново — клиентската валидация е само за UX.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

export const DEFAULT_PHONE_REGION = "BG" as const;

/** Нормализира телефон до E.164 (+359…) или връща null при невалиден номер. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length < 6 || trimmed.length > 25) return null;
  // Разрешени символи: цифри, интервал, +, -, (, ), точка. „00“ в началото = международен.
  if (!/^[\d\s+\-().]+$/.test(trimmed)) return null;
  const candidate = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  const parsed = parsePhoneNumberFromString(candidate, DEFAULT_PHONE_REGION);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export const uuidSchema = z.uuid({ message: "Невалиден идентификатор." });

/** Календарна дата "YYYY-MM-DD", която реално съществува. */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Датата трябва да е във формат ГГГГ-ММ-ДД.")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const t = new Date(Date.UTC(y!, m! - 1, d!));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m! - 1 && t.getUTCDate() === d;
  }, "Несъществуваща дата.");

/** ISO 8601 момент с изрично отместване/зона (напр. 2026-11-12T10:00:00+02:00). */
export const isoDateTimeSchema = z.iso.datetime({
  offset: true,
  local: false,
  message: "Часът трябва да е ISO 8601 с часова зона, напр. 2026-11-12T10:00:00+02:00.",
});

export const customerNameSchema = z
  .string({ message: "Въведете име." })
  .trim()
  .transform((v) => v.replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(2, "Името трябва да е поне 2 символа.")
      .max(80, "Името е твърде дълго (до 80 символа).")
      // Букви от всички азбуки, интервал, тире, апостроф, точка. Без цифри и линкове.
      .regex(/^[\p{L}][\p{L}\p{M} .'’-]*$/u, "Името може да съдържа само букви, интервал и тире."),
  );

export const customerPhoneSchema = z
  .string({ message: "Въведете телефон." })
  .transform((v, ctx) => {
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "Невалиден телефонен номер. Пример: 0888 123 456 или +44 7700 900123.",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const slotsQuerySchema = z.object({
  serviceId: uuidSchema,
  barberId: uuidSchema,
  date: dateStringSchema,
});
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

export const createBookingSchema = z.object({
  serviceId: uuidSchema,
  barberId: uuidSchema,
  start: isoDateTimeSchema,
  customerName: customerNameSchema,
  customerPhone: customerPhoneSchema,
});
export type CreateBookingInput = z.input<typeof createBookingSchema>;
export type CreateBookingData = z.output<typeof createBookingSchema>;

/** Формата добавя съгласие и honeypot към същата схема. */
export const bookingFormSchema = createBookingSchema.extend({
  consent: z.literal(true, { message: "Необходимо е съгласие за обработка на личните данни." }),
  /** Honeypot: трябва да остане празно. */
  website: z.string().max(0).optional().default(""),
});
