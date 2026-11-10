"use client";

import { useState } from "react";

/**
 * Карта на OpenStreetMap (безплатна), която се зарежда едва след клик — без
 * заявки към трети страни при отваряне на страницата и без влияние върху LCP.
 */
export function MapEmbed({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const [show, setShow] = useState(false);
  const d = 0.004;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d / 1.6}%2C${lng + d}%2C${lat + d / 1.6}&layer=mapnik&marker=${lat}%2C${lng}`;

  if (show) {
    return (
      <iframe
        title={`Карта: ${label}`}
        src={src}
        className="border-bone/15 aspect-[4/3] w-full rounded-sm border"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="photo-placeholder border-bone/15 flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-sm border p-6 text-center">
      <p className="text-bone/70 max-w-xs text-sm">
        Картата се зарежда от OpenStreetMap. При показване вашият браузър ще се свърже с техните
        сървъри.
      </p>
      <button
        type="button"
        onClick={() => setShow(true)}
        className="border-brass text-brass hover:bg-brass hover:text-ink focus-visible:outline-brass rounded-sm border px-4 py-2 text-sm font-semibold uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Покажи картата
      </button>
    </div>
  );
}
