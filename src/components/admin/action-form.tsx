"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/admin/actions";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Форма със Server Action: показва съобщенията за успех/грешка и грешките по полета. */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const fieldErrors = Object.entries(state?.fields ?? {}).filter(([k]) => k !== "_");
  return (
    <form action={formAction} className={className} noValidate>
      {state?.error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-400/40 bg-red-950/40 px-3 py-2 text-sm text-red-200"
        >
          <p>{state.error}</p>
          {fieldErrors.length > 1 && (
            <ul className="mt-1 list-inside list-disc text-red-200/80">
              {fieldErrors.map(([k, v]) => (
                <li key={k}>{v}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {state?.ok && (
        <p
          role="status"
          className="mb-4 rounded-md border border-emerald-400/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200"
        >
          {state.ok}
        </p>
      )}
      {children}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  name,
  value,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-brass text-ink hover:bg-brass/90",
    secondary: "border border-bone/25 text-bone hover:bg-bone/10",
    danger: "bg-red-700 text-white hover:bg-red-600",
  }[variant];
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`focus-visible:outline-brass inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${styles}`}
    >
      {pending ? "Изпращане…" : children}
    </button>
  );
}
