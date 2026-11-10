import "server-only";
import { env } from "@/config/env";
import { getDb } from "@/db";
import { createBookingService, type BookingRules, type BookingService } from "./service";

export function bookingRulesFromEnv(): BookingRules {
  const e = env();
  return {
    tz: e.BUSINESS_TIMEZONE,
    currency: e.CURRENCY,
    stepMin: e.SLOT_STEP_MIN,
    minLeadMin: e.MIN_LEAD_MIN,
    horizonDays: e.BOOKING_HORIZON_DAYS,
    maxActivePerPhone: e.MAX_ACTIVE_BOOKINGS_PER_PHONE,
    cancelCutoffHours: e.CANCEL_CUTOFF_HOURS,
    rateLimits: {
      perClientPerHour: e.BOOKING_RATE_LIMIT_PER_CLIENT_HOUR,
      perPhonePerDay: e.BOOKING_RATE_LIMIT_PER_PHONE_DAY,
    },
  };
}

let instance: BookingService | undefined;

/** Споделеният booking service за приложението (форма, Agent API, админ). */
export function bookingService(): BookingService {
  instance ??= createBookingService({ db: getDb(), rules: bookingRulesFromEnv() });
  return instance;
}

export { BookingError, isBookingError } from "./errors";
export type { BookingErrorCode, SlotDto } from "./errors";
export type {
  BookingView,
  PublicBarber,
  ServiceWithBarbers,
  SlotsResult,
  BookingSource,
} from "./service";
