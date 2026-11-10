import "server-only";
/**
 * Agent API (/api/agent/v1/*) — тънък слой над booking service за n8n агента.
 * Само валидиране на транспорта (хедъри, JSON), сериализация и идемпотентност;
 * цялата бизнес логика е в booking service.
 */
import { env } from "@/config/env";
import { getDb } from "@/db";
import { bookingService, type BookingView } from "@/server/booking";
import { errorResponse, json, jsonError, readJsonBody } from "@/server/http";
import { toZonedIso } from "@/server/time";
import { guardAgentRequest } from "./auth";
import { hashRequestBody, IDEMPOTENCY_KEY_RE, withIdempotency } from "./idempotency";

const CHAT_SESSION_RE = /^[A-Za-z0-9_-]{8,128}$/;

const price = (cents: number) => Math.round(cents) / 100;

export function manageUrl(token: string): string {
  return new URL(`/booking/${token}`, env().PUBLIC_BASE_URL).toString();
}

export function agentBookingDto(b: BookingView, token: string) {
  const tz = env().BUSINESS_TIMEZONE;
  return {
    booking: {
      id: b.id,
      start: toZonedIso(b.start, tz),
      end: toZonedIso(b.end, tz),
      service: { name: b.serviceName, price: price(b.priceCents), currency: b.currency },
      barber: { name: b.barberName },
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      status: b.status,
      manageUrl: manageUrl(token),
    },
  };
}

export async function getServices(req: Request): Promise<Response> {
  const denied = await guardAgentRequest(req);
  if (denied) return denied;
  try {
    const services = await bookingService().listActiveServices();
    return json({
      currency: env().CURRENCY,
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        durationMin: s.durationMin,
        price: price(s.priceCents),
        barbers: s.barbers,
      })),
    });
  } catch (err) {
    return errorResponse(err, "agent-api/services");
  }
}

export async function getSlots(req: Request): Promise<Response> {
  const denied = await guardAgentRequest(req);
  if (denied) return denied;
  try {
    const params = new URL(req.url).searchParams;
    const result = await bookingService().getAvailableSlots({
      serviceId: params.get("serviceId") ?? undefined,
      barberId: params.get("barberId") ?? undefined,
      date: params.get("date") ?? undefined,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err, "agent-api/slots");
  }
}

export async function postBooking(req: Request): Promise<Response> {
  const denied = await guardAgentRequest(req);
  if (denied) return denied;

  const idemKey = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY_RE.test(idemKey)) {
    return jsonError(
      422,
      "idempotency_key_required",
      "Липсва или е невалиден хедър Idempotency-Key (8–200 видими ASCII символа, без интервали).",
    );
  }

  const body = await readJsonBody(req);
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(422, "invalid_json", "Тялото на заявката трябва да е JSON обект.");
  }

  const rawSession = req.headers.get("x-chat-session-id")?.trim() ?? "";
  const chatSessionId = CHAT_SESSION_RE.test(rawSession) ? rawSession : null;
  const { IDEMPOTENCY_TTL_HOURS } = env();

  try {
    const result = await withIdempotency(
      getDb(),
      {
        scope: "agent:bookings",
        key: idemKey,
        requestHash: hashRequestBody(body),
        ttlMs: IDEMPOTENCY_TTL_HOURS * 3_600_000,
      },
      async () => {
        const { booking, token } = await bookingService().createBooking(body, {
          source: "chat",
          clientKey: chatSessionId ? `chat:${chatSessionId}` : null,
          chatSessionId,
        });
        return { status: 201, body: agentBookingDto(booking, token), bookingId: booking.id };
      },
    );
    return json(
      result.body,
      result.status,
      result.replayed ? { "Idempotent-Replayed": "true" } : {},
    );
  } catch (err) {
    return errorResponse(err, "agent-api/bookings");
  }
}
