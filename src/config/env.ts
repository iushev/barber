import "server-only";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((v) => v === "true" || v === "1" || v === "yes");

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  BUSINESS_TIMEZONE: z.string().min(1).default("Europe/Sofia"),
  CURRENCY: z.string().length(3).default("EUR"),

  COOKIE_SECURE: bool.default(false),
  TRUST_PROXY: bool.default(false),

  SLOT_STEP_MIN: z.coerce
    .number()
    .int()
    .refine((v) => v === 15 || v === 30, "SLOT_STEP_MIN трябва да е 15 или 30")
    .default(15),
  MIN_LEAD_MIN: z.coerce.number().int().min(0).default(60),
  BOOKING_HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  MAX_ACTIVE_BOOKINGS_PER_PHONE: z.coerce.number().int().min(1).default(3),
  CANCEL_CUTOFF_HOURS: z.coerce.number().min(0).default(2),
  /** Опити за записване на час от един клиент (IP за формата, сесия за чата). */
  BOOKING_RATE_LIMIT_PER_CLIENT_HOUR: z.coerce.number().int().min(1).default(10),
  BOOKING_RATE_LIMIT_PER_PHONE_DAY: z.coerce.number().int().min(1).default(6),

  AGENT_API_KEY: z.string().min(32).optional(),
  /** Заявки към Agent API в минута (всички идват от n8n). */
  AGENT_API_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  /** Колко време се пази Idempotency-Key (и отговорът към него). */
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().min(1).max(168).default(24),
  N8N_CHAT_URL: z.string().url().optional(),
  N8N_CHAT_USER: z.string().min(1).optional(),
  N8N_CHAT_PASSWORD: z.string().min(1).optional(),
  /** Ограничения на чата (разход към OpenAI). */
  CHAT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
  CHAT_RATE_LIMIT_PER_DAY: z.coerce.number().int().min(1).default(150),
  CHAT_MAX_MESSAGES_PER_SESSION: z.coerce.number().int().min(1).default(60),
  CHAT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(90_000),
  /** Служебен webhook в n8n за изтриване на чат история по sessionId (GDPR). */
  N8N_CHAT_PURGE_URL: z.string().url().optional(),

  UPLOADS_DIR: z.string().default("./uploads"),
  /** След колко месеца от посещението личните данни се анонимизират автоматично. */
  DATA_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(24),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Валидира env мързеливо (при първа употреба), за да не се проваля `next build`,
 * когато runtime променливите още не са налични. При грешка хвърля с имената на
 * проблемните променливи, без стойностите им.
 */
export function env(): ServerEnv {
  if (cached) return cached;
  // Docker Compose подава незададените незадължителни променливи като "" (`${VAR:-}`)
  // → празен низ се третира като липсваща стойност (важат стойностите по подразбиране).
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = serverEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Невалидна конфигурация на средата:\n  ${problems.join("\n  ")}`);
  }
  cached = parsed.data;
  return cached;
}
