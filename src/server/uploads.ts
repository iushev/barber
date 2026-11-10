/**
 * Качване на снимки на бръснари в UPLOADS_DIR (именуван Docker volume).
 * - Типът се определя по „magic bytes“, не по името/MIME типа от браузъра.
 * - Името на файла се генерира (UUID) → няма path traversal.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AdminError } from "@/server/admin/errors";

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const TYPES = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;
export type PhotoExt = keyof typeof TYPES;

/** Разрешени относителни пътища: barbers/<uuid>.<ext> */
export const PHOTO_PATH_RE = /^barbers\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export function detectImageType(buf: Uint8Array): PhotoExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (
    buf.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    String.fromCharCode(...buf.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...buf.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function contentTypeFor(relPath: string): string {
  const ext = relPath.split(".").pop() as PhotoExt;
  return TYPES[ext] ?? "application/octet-stream";
}

export function resolveUploadPath(uploadsDir: string, relPath: string): string | null {
  if (!PHOTO_PATH_RE.test(relPath)) return null;
  const root = path.resolve(/*turbopackIgnore: true*/ uploadsDir);
  const full = path.resolve(/*turbopackIgnore: true*/ root, relPath);
  return full.startsWith(root + path.sep) ? full : null;
}

export async function saveBarberPhoto(uploadsDir: string, file: File): Promise<string> {
  if (file.size === 0) throw new AdminError("Изберете файл.");
  if (file.size > MAX_PHOTO_BYTES) throw new AdminError("Снимката трябва да е до 2 MB.");
  const buf = new Uint8Array(await file.arrayBuffer());
  const ext = detectImageType(buf);
  if (!ext) throw new AdminError("Позволени формати: JPEG, PNG, WebP.");
  const rel = `barbers/${randomUUID()}.${ext}`;
  const full = resolveUploadPath(uploadsDir, rel)!;
  // turbopackIgnore: пътят е runtime (volume), не е част от bundle-а.
  await mkdir(/*turbopackIgnore: true*/ path.dirname(full), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ full, buf, { flag: "wx" });
  return rel;
}

export async function deleteUpload(uploadsDir: string, relPath: string | null | undefined) {
  if (!relPath) return;
  const full = resolveUploadPath(uploadsDir, relPath);
  if (full) await rm(/*turbopackIgnore: true*/ full, { force: true });
}

export async function readUpload(uploadsDir: string, relPath: string): Promise<Buffer | null> {
  const full = resolveUploadPath(uploadsDir, relPath);
  if (!full) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ full);
  } catch {
    return null;
  }
}
