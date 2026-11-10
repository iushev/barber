/**
 * Домейн грешки на booking service. Съобщенията са кратки, на български и
 * подходящи както за потребителя, така и за LLM агента.
 */

export type BookingErrorCode =
  | "validation_error"
  | "service_not_found"
  | "barber_not_found"
  | "service_inactive"
  | "barber_inactive"
  | "barber_service_mismatch"
  | "date_in_past"
  | "date_beyond_horizon"
  | "invalid_slot"
  | "slot_taken"
  | "too_many_active_bookings"
  | "rate_limited"
  | "booking_not_found"
  | "already_cancelled"
  | "not_cancellable"
  | "cancel_too_late"
  | "idempotency_key_reused"
  | "idempotency_in_progress";

export interface SlotDto {
  start: string;
  end: string;
  label: string;
}

export interface BookingErrorDetails {
  fields?: Record<string, string>;
  alternatives?: SlotDto[];
  retryAfterSec?: number;
}

const HTTP_STATUS: Record<BookingErrorCode, number> = {
  validation_error: 422,
  service_not_found: 422,
  barber_not_found: 422,
  service_inactive: 422,
  barber_inactive: 422,
  barber_service_mismatch: 422,
  date_in_past: 422,
  date_beyond_horizon: 422,
  invalid_slot: 422,
  slot_taken: 409,
  too_many_active_bookings: 422,
  rate_limited: 429,
  booking_not_found: 404,
  already_cancelled: 409,
  not_cancellable: 409,
  cancel_too_late: 409,
  idempotency_key_reused: 422,
  idempotency_in_progress: 409,
};

export class BookingError extends Error {
  readonly code: BookingErrorCode;
  readonly details: BookingErrorDetails;

  constructor(code: BookingErrorCode, message: string, details: BookingErrorDetails = {}) {
    super(message);
    this.name = "BookingError";
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export function isBookingError(err: unknown): err is BookingError {
  return err instanceof BookingError;
}

/** Postgres exclusion_violation (застъпване по `bookings_no_overlap`). */
export function isOverlapViolation(err: unknown): boolean {
  let e: unknown = err;
  // Drizzle обвива грешката на драйвера в `cause`.
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const rec = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (rec.code === "23P01") return true;
    e = rec.cause;
  }
  return false;
}
