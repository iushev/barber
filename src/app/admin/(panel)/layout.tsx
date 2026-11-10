import Link from "next/link";
import { runRetentionIfDue } from "@/server/admin/retention";
import { requireAdmin } from "@/server/auth/session";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin/bookings", label: "Резервации" },
  { href: "/admin/bookings/new", label: "Нова резервация" },
  { href: "/admin/barbers", label: "Бръснари" },
  { href: "/admin/services", label: "Услуги" },
  { href: "/admin/account", label: "Профил" },
];

/** Всички страници под (panel) изискват валидна сесия — проверка на сървъра. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  await runRetentionIfDue();
  return (
    <>
      <header className="border-bone/10 bg-coal border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/admin/bookings" className="text-brass font-semibold">
            Админ
          </Link>
          <nav aria-label="Админ навигация" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-bone/80 hover:text-brass">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-bone/60 hidden sm:inline">{admin.email}</span>
            <button
              type="submit"
              className="text-bone/80 hover:text-brass underline-offset-4 hover:underline"
            >
              Изход
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
