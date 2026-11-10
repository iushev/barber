"use server";
/**
 * Публични Server Actions: записване от формата и отмяна по таен линк.
 * CSRF: Next.js проверява Origin ↔ Host за всеки Server Action.
 */
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { bookingFormSchema } from "@/lib/validation/booking";
import { bookingService, isBookingError, type SlotDto } from "@/server/booking";
import { clientIp } from "@/server/http";

export type BookingFormResult =
  | {
      error: string;
      code?: string;
      fields?: Record<string, string>;
      alternatives?: SlotDto[];
    }
  | undefined;

export interface BookingFormInput {
  serviceId: string;
  barberId: string;
  start: string;
  customerName: string;
  customerPhone: string;
  consent: boolean;
  website: string;
}

async function requestIp(): Promise<string> {
  return clientIp(new Request("http://local", { headers: await headers() }));
}

export async function createBookingAction(input: BookingFormInput): Promise<BookingFormResult> {
  // Сървърна валидация на всичко, вкл. съгласието и honeypot полето.
  const parsed = bookingFormSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join(".")] ??= i.message;
    if (fields.website) {
      // Honeypot е попълнен → бот. Общо съобщение, без подробности.
      return { error: "Заявката не може да бъде обработена.", code: "rejected" };
    }
    return {
      error: Object.values(fields)[0] ?? "Невалидни данни.",
      code: "validation_error",
      fields,
    };
  }

  let token: string;
  try {
    const { serviceId, barberId, start, customerName, customerPhone } = input;
    const result = await bookingService().createBooking(
      { serviceId, barberId, start, customerName, customerPhone },
      { source: "web", clientKey: await requestIp() },
    );
    token = result.token;
  } catch (err) {
    unstable_rethrow(err);
    if (isBookingError(err)) {
      return {
        error: err.message,
        code: err.code,
        fields: err.details.fields,
        alternatives: err.details.alternatives,
      };
    }
    console.error(`[book] неочаквана грешка: ${err instanceof Error ? err.message : String(err)}`);
    return { error: "Възникна грешка. Опитайте отново или ни се обадете.", code: "internal_error" };
  }
  redirect(`/booking/${token}?new=1`);
}

export type CancelResult = { ok?: boolean; error?: string } | undefined;

export async function cancelBookingAction(
  token: string,
  _prev: CancelResult,
): Promise<CancelResult> {
  try {
    await bookingService().cancelByToken(token);
    return { ok: true };
  } catch (err) {
    if (isBookingError(err)) return { error: err.message };
    console.error(
      `[cancel] неочаквана грешка: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { error: "Възникна грешка. Опитайте отново или ни се обадете." };
  }
}
