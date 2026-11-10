"use client";

import { useActionState, useState } from "react";
import type { CancelResult } from "@/app/(public)/actions";

/** Отмяна с потвърждение в две стъпки (за да няма случайно натискане). */
export function CancelBooking({
  action,
}: {
  action: (prev: CancelResult) => Promise<CancelResult>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(action, undefined);

  if (state?.ok) {
    return (
      <p role="status" className="text-emerald-300">
        Часът е отменен. Благодарим, че ни уведомихте!
      </p>
    );
  }
  return (
    <div>
      {state?.error && (
        <p role="alert" className="mb-3 text-red-300">
          {state.error}
        </p>
      )}
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="border-bone/30 rounded-sm border px-5 py-3 text-sm font-semibold uppercase hover:border-red-400 hover:text-red-300"
        >
          Отмени часа
        </button>
      ) : (
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <span className="text-sm">Сигурни ли сте?</span>
          <button
            type="submit"
            disabled={pending}
            className="rounded-sm bg-red-700 px-5 py-3 text-sm font-semibold text-white uppercase hover:bg-red-600 disabled:opacity-60"
          >
            {pending ? "Отменяне…" : "Да, отмени"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-bone/60 hover:text-bone text-sm"
          >
            Не
          </button>
        </form>
      )}
    </div>
  );
}
