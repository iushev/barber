import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { site } from "@/config/site";

/**
 * OG изображение (1200×630) за споделяне в социални мрежи. Генерира се при build
 * (статично), затова шрифтът от node_modules не е нужен в production образа.
 * Шрифтът по подразбиране на next/og няма кирилица → Oswald (woff) от @fontsource.
 */
export const alt = site.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

const font = (file: string) =>
  readFile(join(process.cwd(), "node_modules/@fontsource/oswald/files", file));

export default async function OpengraphImage() {
  const [cyr600, lat600, cyr400, lat400] = await Promise.all([
    font("oswald-cyrillic-600-normal.woff"),
    font("oswald-latin-600-normal.woff"),
    font("oswald-cyrillic-400-normal.woff"),
    font("oswald-latin-400-normal.woff"),
  ]);
  const stripe =
    "repeating-linear-gradient(45deg, #c39a5f 0 18px, #11100e 18px 36px, #6e2420 36px 54px, #11100e 54px 72px)";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#11100e",
        color: "#efe8dc",
        fontFamily: "OswaldCyr, OswaldLat",
        padding: "72px 80px",
      }}
    >
      <div style={{ display: "flex", height: 14, width: 240, backgroundImage: stripe }} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{ fontSize: 96, fontWeight: 600, textTransform: "uppercase", lineHeight: 1.05 }}
        >
          {site.shortName}
        </div>
        <div style={{ fontSize: 40, fontWeight: 400, color: "#c39a5f", marginTop: 24 }}>
          {site.tagline}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 30,
          color: "#efe8dcb3",
        }}
      >
        <span>
          {site.address.street}, {site.address.city}
        </span>
        <span style={{ color: "#c39a5f" }}>Запази час онлайн</span>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        // Отделни фамилии: при едно и също име satori ползва само първия файл.
        { name: "OswaldCyr", data: cyr600, weight: 600, style: "normal" },
        { name: "OswaldCyr", data: cyr400, weight: 400, style: "normal" },
        { name: "OswaldLat", data: lat600, weight: 600, style: "normal" },
        { name: "OswaldLat", data: lat400, weight: 400, style: "normal" },
      ],
    },
  );
}
