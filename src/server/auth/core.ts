/**
 * Администраторска автентикация — независима от Next.js (тестваема с инжектирана БД).
 * - Сесии: случаен токен (32 байта) в cookie; в БД се пази само SHA-256 хешът.
 * - Вход: rate limit по IP и по имейл; проверката на паролата отнема еднакво време
 *   и когато потребителят не съществува (сравнение срещу фиктивен хеш).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { adminSessions, adminUsers } from "@/db/schema";
import type { Executor } from "@/server/db-types";
import { consumeRateLimit } from "@/server/ratelimit";
import { hashPassword, verifyPassword } from "./password";

export const SESSION_TTL_MS = 12 * 3_600_000;

const LOGIN_LIMIT_PER_IP = { limit: 10, windowSec: 15 * 60 };
const LOGIN_LIMIT_PER_EMAIL = { limit: 5, windowSec: 15 * 60 };

export interface AdminIdentity {
  id: string;
  email: string;
}

export type LoginResult =
  | { ok: true; admin: AdminIdentity; token: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "rate_limited"; retryAfterSec?: number };

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

export async function createSession(
  db: Executor,
  adminUserId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(adminSessions).values({ id: sha256(token), adminUserId, expiresAt });
  // Почистване на изтекли сесии.
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  return { token, expiresAt };
}

export async function validateSession(
  db: Executor,
  token: string | undefined,
  now = new Date(),
): Promise<AdminIdentity | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db
    .select({ id: adminUsers.id, email: adminUsers.email })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(and(eq(adminSessions.id, sha256(token)), gt(adminSessions.expiresAt, now)));
  return row ?? null;
}

export async function deleteSession(db: Executor, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(adminSessions).where(eq(adminSessions.id, sha256(token)));
}

export async function login(
  db: Executor,
  input: { email: string; password: string; ip: string },
  now = new Date(),
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase().slice(0, 254);

  for (const [scope, id, cfg] of [
    ["login:ip", input.ip, LOGIN_LIMIT_PER_IP],
    ["login:email", email, LOGIN_LIMIT_PER_EMAIL],
  ] as const) {
    const rl = await consumeRateLimit(db, { scope, id, now, ...cfg });
    if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterSec: rl.retryAfterSec };
  }

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(sql`lower(${adminUsers.email}) = ${email}`);
  const passwordOk = await verifyPassword(
    input.password.slice(0, 1024),
    user?.passwordHash ?? (await getDummyHash()),
  );
  if (!user || !passwordOk) return { ok: false, reason: "invalid" };

  const session = await createSession(db, user.id, now);
  return { ok: true, admin: { id: user.id, email: user.email }, ...session };
}

/** Смяна на парола: инвалидира всички сесии на администратора. */
export async function changePassword(db: Executor, adminUserId: string, newPassword: string) {
  await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(adminUsers.id, adminUserId));
  await db.delete(adminSessions).where(eq(adminSessions.adminUserId, adminUserId));
}
