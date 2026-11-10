"use server";
/**
 * Server Actions на админ панела. Всяко действие:
 *  1. проверява сесията на сървъра (requireAdmin) — не разчита на UI/proxy;
 *  2. валидира входа (в service слоя, със Zod);
 *  3. връща състояние за формата или пренасочва.
 * CSRF: Next.js сравнява Origin с Host за всеки Server Action; cookie-то е SameSite=Lax.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { env } from "@/config/env";
import { getDb } from "@/db";
import { adminUsers } from "@/db/schema";
import { loginSchema, passwordChangeSchema } from "@/lib/validation/admin";
import { anonymizeBookings, chatSessionsFor, deleteBooking } from "@/server/admin/bookings";
import * as catalog from "@/server/admin/catalog";
import { AdminError, parseAdmin } from "@/server/admin/errors";
import { changePassword } from "@/server/auth/core";
import { verifyPassword } from "@/server/auth/password";
import { requireAdmin, signIn, signOut } from "@/server/auth/session";
import { bookingService, isBookingError } from "@/server/booking";
import { purgeChatSessions } from "@/server/n8n";
import { deleteUpload, saveBarberPhoto } from "@/server/uploads";

export type ActionState =
  | { ok?: string; error?: string; fields?: Record<string, string>; needsConfirm?: number }
  | undefined;

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

/** Превежда домейн грешките в състояние на формата; пренасочванията се препредават. */
async function attempt(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AdminError) return { error: err.message, fields: err.fields };
    if (isBookingError(err)) {
      const alt = err.details.alternatives?.map((a) => a.label).join(", ");
      return {
        error: alt ? `${err.message} (${alt})` : err.message,
        fields: err.details.fields,
      };
    }
    console.error(`[admin] неочаквана грешка: ${err instanceof Error ? err.message : String(err)}`);
    return { error: "Възникна неочаквана грешка. Опитайте отново." };
  }
}

// ---------------------------------------------------------------------------
// Вход / изход / парола
// ---------------------------------------------------------------------------

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: str(fd, "email"), password: str(fd, "password") });
  if (!parsed.success) return { error: "Невалиден имейл или парола." };
  const result = await signIn(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    return result.reason === "rate_limited"
      ? {
          error: `Твърде много опити. Опитайте отново след ${Math.ceil((result.retryAfterSec ?? 60) / 60)} мин.`,
        }
      : { error: "Невалиден имейл или парола." };
  }
  redirect("/admin/bookings");
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect("/admin/login");
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  return attempt(async () => {
    const data = parseAdmin(passwordChangeSchema, {
      current: str(fd, "current"),
      next: str(fd, "next"),
      confirm: str(fd, "confirm"),
    });
    const db = getDb();
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
    if (!user || !(await verifyPassword(data.current, user.passwordHash))) {
      return { error: "Текущата парола е грешна.", fields: { current: "Грешна парола" } };
    }
    await changePassword(db, admin.id, data.next);
    await signOut();
    redirect("/admin/login");
  });
}

// ---------------------------------------------------------------------------
// Бръснари
// ---------------------------------------------------------------------------

const barberInput = (fd: FormData) => ({
  name: str(fd, "name"),
  slug: str(fd, "slug"),
  bio: str(fd, "bio"),
  sortOrder: str(fd, "sortOrder") || "0",
  serviceIds: fd.getAll("serviceIds").filter((v): v is string => typeof v === "string"),
});

export async function createBarberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const id = await catalog.createBarber(getDb(), barberInput(fd));
    revalidatePath("/admin/barbers");
    redirect(`/admin/barbers/${id}`);
  });
}

export async function updateBarberAction(
  barberId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    await catalog.updateBarber(getDb(), barberId, barberInput(fd));
    revalidatePath("/admin/barbers");
    revalidatePath("/", "layout");
    return { ok: "Промените са запазени." };
  });
}

export async function uploadBarberPhotoAction(
  barberId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const file = fd.get("photo");
    if (!(file instanceof File)) throw new AdminError("Изберете файл.");
    const dir = env().UPLOADS_DIR;
    const rel = await saveBarberPhoto(dir, file);
    try {
      const previous = await catalog.setBarberPhoto(getDb(), barberId, rel);
      await deleteUpload(dir, previous);
    } catch (err) {
      await deleteUpload(dir, rel);
      throw err;
    }
    revalidatePath(`/admin/barbers/${barberId}`);
    revalidatePath("/", "layout");
    return { ok: "Снимката е качена." };
  });
}

export async function removeBarberPhotoAction(
  barberId: string,
  _prev: ActionState,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const previous = await catalog.setBarberPhoto(getDb(), barberId, null);
    await deleteUpload(env().UPLOADS_DIR, previous);
    revalidatePath(`/admin/barbers/${barberId}`);
    revalidatePath("/", "layout");
    return { ok: "Снимката е премахната." };
  });
}

export async function setBarberActiveAction(
  barberId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const active = str(fd, "active") === "true";
    const res = await catalog.setBarberActive(
      getDb(),
      barberId,
      active,
      str(fd, "confirm") === "on",
    );
    if (!res.ok) {
      return {
        error: `Бръснарят има ${res.affected} предстоящи резервации. Потвърдете деактивирането.`,
        needsConfirm: res.affected,
      };
    }
    revalidatePath(`/admin/barbers/${barberId}`);
    revalidatePath("/", "layout");
    return { ok: active ? "Бръснарят е активиран." : "Бръснарят е деактивиран." };
  });
}

export async function saveScheduleAction(
  barberId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const days = Array.from({ length: 7 }, (_, i) => ({
      enabled: str(fd, `d${i}_enabled`) === "on",
      start: str(fd, `d${i}_start`),
      end: str(fd, `d${i}_end`),
      breakStart: str(fd, `d${i}_breakStart`),
      breakEnd: str(fd, `d${i}_breakEnd`),
    }));
    await catalog.saveWeeklySchedule(getDb(), barberId, days);
    revalidatePath(`/admin/barbers/${barberId}`);
    revalidatePath("/", "layout");
    return { ok: "Графикът е запазен." };
  });
}

export async function upsertExceptionAction(
  barberId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    await catalog.upsertException(getDb(), barberId, {
      type: str(fd, "type"),
      date: str(fd, "date"),
      note: str(fd, "note"),
      start: str(fd, "start"),
      end: str(fd, "end"),
      breakStart: str(fd, "breakStart"),
      breakEnd: str(fd, "breakEnd"),
    });
    revalidatePath(`/admin/barbers/${barberId}`);
    return { ok: "Изключението е запазено." };
  });
}

export async function deleteExceptionAction(
  barberId: string,
  exceptionId: string,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    await catalog.deleteException(getDb(), exceptionId);
    revalidatePath(`/admin/barbers/${barberId}`);
    return { ok: "Изключението е изтрито." };
  });
}

// ---------------------------------------------------------------------------
// Услуги
// ---------------------------------------------------------------------------

const serviceInput = (fd: FormData) => ({
  name: str(fd, "name"),
  description: str(fd, "description"),
  durationMin: str(fd, "durationMin"),
  price: str(fd, "price"),
  sortOrder: str(fd, "sortOrder") || "0",
});

export async function createServiceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const id = await catalog.createService(getDb(), serviceInput(fd));
    revalidatePath("/admin/services");
    revalidatePath("/", "layout");
    redirect(`/admin/services/${id}`);
  });
}

export async function updateServiceAction(
  serviceId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    await catalog.updateService(getDb(), serviceId, serviceInput(fd));
    revalidatePath("/admin/services");
    revalidatePath("/", "layout");
    return {
      ok: "Промените са запазени. Съществуващите резервации пазят старата цена и продължителност.",
    };
  });
}

export async function setServiceActiveAction(
  serviceId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const active = str(fd, "active") === "true";
    const res = await catalog.setServiceActive(
      getDb(),
      serviceId,
      active,
      str(fd, "confirm") === "on",
    );
    if (!res.ok) {
      return {
        error: `Услугата има ${res.affected} предстоящи резервации. Потвърдете деактивирането.`,
        needsConfirm: res.affected,
      };
    }
    revalidatePath(`/admin/services/${serviceId}`);
    revalidatePath("/", "layout");
    return { ok: active ? "Услугата е активирана." : "Услугата е деактивирана." };
  });
}

// ---------------------------------------------------------------------------
// Резервации
// ---------------------------------------------------------------------------

export async function createAdminBookingAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const { booking } = await bookingService().createBooking(
      {
        serviceId: str(fd, "serviceId"),
        barberId: str(fd, "barberId"),
        start: str(fd, "start"),
        customerName: str(fd, "customerName"),
        customerPhone: str(fd, "customerPhone"),
      },
      { source: "admin" },
    );
    revalidatePath("/admin/bookings");
    redirect(`/admin/bookings/${booking.id}?created=1`);
  });
}

export async function setBookingStatusAction(
  bookingId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const status = str(fd, "status");
    if (!["confirmed", "cancelled", "completed", "no_show"].includes(status)) {
      throw new AdminError("Невалиден статус.");
    }
    await bookingService().setStatus(bookingId, status as "confirmed");
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/admin/bookings");
    return { ok: "Статусът е променен." };
  });
}

export async function rescheduleBookingAction(
  bookingId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    const barberId = str(fd, "barberId");
    await bookingService().reschedule(bookingId, {
      start: str(fd, "start"),
      barberId: barberId || undefined,
    });
    revalidatePath(`/admin/bookings/${bookingId}`);
    revalidatePath("/admin/bookings");
    redirect(`/admin/bookings/${bookingId}?moved=1`);
  });
}

function purgeMessage(
  res: Awaited<ReturnType<typeof purgeChatSessions>>,
  sessions: number,
): string {
  if (sessions === 0) return "";
  if (res.ok) return ` Чат историята (${sessions} сесии) е изчистена в n8n.`;
  return res.reason === "not_configured"
    ? " ВНИМАНИЕ: N8N_CHAT_PURGE_URL не е настроен — изчистете чат историята ръчно в n8n."
    : " ВНИМАНИЕ: чат историята в n8n НЕ беше изчистена (n8n не отговори). Опитайте отново.";
}

export async function anonymizeAction(
  bookingId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    if (str(fd, "confirm") !== "on") throw new AdminError("Потвърдете анонимизирането.");
    const db = getDb();
    const booking = await bookingService().getBookingById(bookingId);
    if (!booking) throw new AdminError("Резервацията не е намерена.");
    const byPhone = str(fd, "scope") === "phone" && booking.customerPhone;
    const res = await anonymizeBookings(
      db,
      byPhone ? { phone: booking.customerPhone } : { ids: [booking.id] },
    );
    const purge = await purgeChatSessions(res.chatSessionIds);
    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${bookingId}`);
    return {
      ok: `Анонимизирани резервации: ${res.count}.${purgeMessage(purge, res.chatSessionIds.length)}`,
    };
  });
}

export async function deleteBookingAction(
  bookingId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requireAdmin();
  return attempt(async () => {
    if (str(fd, "confirm") !== "on") throw new AdminError("Потвърдете изтриването.");
    const db = getDb();
    const sessions = await chatSessionsFor(db, [bookingId]);
    const res = await deleteBooking(db, bookingId);
    if (!res.deleted) throw new AdminError("Резервацията не е намерена.");
    await purgeChatSessions(sessions);
    revalidatePath("/admin/bookings");
    redirect("/admin/bookings?deleted=1");
  });
}
