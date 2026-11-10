import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABELS } from "@/lib/format";

export const inputClass =
  "w-full rounded-md border border-bone/20 bg-coal px-3 py-2 text-sm text-bone placeholder:text-bone/40 focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

export function PageHeader({
  title,
  actions,
  back,
}: {
  title: string;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="text-bone/60 hover:text-brass text-sm">
          ← {back.label}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {actions}
      </div>
    </div>
  );
}

export function Card({
  title,
  children,
  description,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-bone/10 bg-coal/60 mb-6 rounded-lg border p-4 sm:p-6">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {description && <div className="text-bone/60 mt-1 text-sm">{description}</div>}
      <div className={title ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  name,
  hint,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-bone/80 text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-bone/60 text-xs">{hint}</p>}
    </div>
  );
}

const STATUS_STYLES: Record<keyof typeof STATUS_LABELS, string> = {
  confirmed: "bg-emerald-900/60 text-emerald-200",
  cancelled: "bg-zinc-700/60 text-zinc-300",
  completed: "bg-sky-900/60 text-sky-200",
  no_show: "bg-red-900/60 text-red-200",
};

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABELS }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="rounded bg-emerald-900/60 px-2 py-0.5 text-xs text-emerald-200">Активен</span>
  ) : (
    <span className="rounded bg-zinc-700/60 px-2 py-0.5 text-xs text-zinc-300">Неактивен</span>
  );
}

export function Flash({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="mb-4 rounded-md border border-emerald-400/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200"
    >
      {children}
    </p>
  );
}

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="bg-brass text-ink hover:bg-brass/90 focus-visible:outline-brass inline-flex items-center rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {children}
    </Link>
  );
}
