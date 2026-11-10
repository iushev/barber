import "server-only";
/**
 * Публични GET endpoint-и за формата за записване (/api/public/*): свободни дати и
 * часове. Само четене; rate limit по IP срещу „изстъргване“ и натоварване.
 */
import { getDb } from "@/db";
import { bookingService } from "@/server/booking";
import { clientIp, errorResponse, json, jsonError } from "@/server/http";
import { consumeRateLimit } from "@/server/ratelimit";

const READS_PER_MIN = 120;

async function guard(req: Request): Promise<Response | null> {
  const rl = await consumeRateLimit(getDb(), {
    scope: "public:read",
    id: clientIp(req),
    limit: READS_PER_MIN,
    windowSec: 60,
  });
  if (rl.allowed) return null;
  return jsonError(
    429,
    "rate_limited",
    "Твърде много заявки. Опитайте след малко.",
    {},
    {
      "Retry-After": String(rl.retryAfterSec),
    },
  );
}

const params = (req: Request) => new URL(req.url).searchParams;

export async function getPublicAvailability(req: Request): Promise<Response> {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const p = params(req);
    const result = await bookingService().getAvailableDates({
      serviceId: p.get("serviceId") ?? undefined,
      barberId: p.get("barberId") ?? undefined,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err, "public/availability");
  }
}

export async function getPublicSlots(req: Request): Promise<Response> {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const p = params(req);
    const result = await bookingService().getAvailableSlots({
      serviceId: p.get("serviceId") ?? undefined,
      barberId: p.get("barberId") ?? undefined,
      date: p.get("date") ?? undefined,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err, "public/slots");
  }
}
