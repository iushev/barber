"use client";

import { useState } from "react";

/** Тайният линк за управление с бутон за копиране. */
export function ManageLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Без достъп до клипборда — потребителят може да маркира текста ръчно.
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        readOnly
        value={url}
        aria-label="Линк за управление на резервацията"
        onFocus={(e) => e.currentTarget.select()}
        className="border-bone/25 bg-ink min-w-0 flex-1 rounded-sm border px-3 py-2 font-mono text-xs"
      />
      <button
        type="button"
        onClick={copy}
        className="bg-brass text-ink hover:bg-bone shrink-0 rounded-sm px-4 py-2 text-sm font-semibold uppercase"
      >
        {copied ? "Копирано ✓" : "Копирай линка"}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Линкът е копиран" : ""}
      </span>
    </div>
  );
}
