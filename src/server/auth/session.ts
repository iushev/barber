import "server-only";
/**
 * Next.js обвивки около сесиите: cookie + проверка в сървърни компоненти и actions.
 * `src/proxy.ts` прави само бърза проверка за наличие на cookie; истинската
 * проверка е тук и се вика от layout-а на /admin и от всеки Server Action.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "@/config/env";
import { getDb } from "@/db";
import { clientIp } from "@/server/http";
import { deleteSession, login, validateSession, type AdminIdentity } from "./core";

/** С COOKIE_SECURE: префикс __Host- (изисква Secure, Path=/, без Domain). */
export function sessionCookieName(): string {
  return env().COOKIE_SECURE ? "__Host-barber_admin" : "barber_admin";
}

export const SESSION_COOKIE_NAMES = ["__Host-barber_admin", "barber_admin"] as const;

export const getCurrentAdmin = cache(async (): Promise<AdminIdentity | null> => {
  const store = await cookies();
  return validateSession(getDb(), store.get(sessionCookieName())?.value);
});

/** За страници и Server Actions: пренасочва към входа, ако няма валидна сесия. */
export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

export async function signIn(email: string, password: string) {
  const h = await headers();
  const ip = clientIp(new Request("http://local", { headers: h }));
  const result = await login(getDb(), { email, password, ip });
  if (result.ok) {
    const store = await cookies();
    store.set(sessionCookieName(), result.token, {
      httpOnly: true,
      secure: env().COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      expires: result.expiresAt,
    });
  }
  return result;
}

export async function signOut() {
  const store = await cookies();
  const name = sessionCookieName();
  await deleteSession(getDb(), store.get(name)?.value);
  store.delete(name);
}
